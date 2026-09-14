/**
 * The master workbook: every user group in one file.
 *
 * Three sheets, in the order Excel will show them:
 *   1. **Overview**   -- what each sheet is, and when this was exported.
 *   2. **User Groups** -- one line per group with its headline numbers.
 *   3. **Permissions** -- the flat per-state matrix, for every group at once.
 *
 * Why this is a script and not a route
 * ------------------------------------
 * Cost scales with the whole org. The expensive term is P, the number of
 * distinct (role, object type) pairs, because per-state permissions are only
 * available per pair. Roles and object types are heavily shared between
 * groups, so caching collapses a lot of it -- but P is still the term that
 * decides the runtime, and it is not knowable until every role's grants have
 * been read.
 *
 * So the export runs in two phases. The **plan** phase spends only the cheap,
 * shared calls (3 collection + 2 catalog + 1 per distinct role) and can then
 * state P exactly. The **fetch** phase spends P + 2T. A caller can stop after
 * the plan -- that is what `--dry-run` in the CLI does -- and decide whether
 * the number is acceptable before committing to it.
 */
import type { Workbook, Worksheet } from 'exceljs';
import type {
  GroupId,
  GroupListItem,
  GroupMatrix,
  ObjectTypeAccessDetail,
  ObjectTypeId,
  RoleId,
} from '../../shared/types/domain.ts';
import { mapWithConcurrency } from '../http/concurrency.ts';
import { buildMatrixRows, type ObjectTypeDetailFetcher } from './rows.ts';
import { addMatrixSheet, createWorkbook } from './workbook.ts';
import type { MatrixExportRow } from './types.ts';

/** What the master export needs. `MatrixRepository` satisfies it as-is. */
export interface AllGroupsExportSource {
  listGroups(): Promise<GroupListItem[]>;
  getGroupMatrix(groupId: GroupId): Promise<GroupMatrix>;
  getObjectTypeDetail(roleId: RoleId, objectTypeId: ObjectTypeId): Promise<ObjectTypeAccessDetail>;
}

/** What the plan phase learned, before any per-pair call is made. */
export interface ExportPlan {
  groups: GroupMatrix[];
  /** Distinct roles across every group. */
  distinctRoles: number;
  /** Distinct (role, object type) pairs -- one permissions call each. */
  distinctPairs: number;
  /** Distinct object types reached -- two calls each. */
  distinctObjectTypes: number;
  /** Calls the fetch phase will make on a cold cache. */
  estimatedRemainingCalls: number;
}

export interface AllGroupsProgress {
  phase: 'planning' | 'fetching' | 'writing';
  groupsDone: number;
  groupsTotal: number;
  /** Name of the group just finished, when there is one. */
  currentGroup?: string;
  rowsSoFar: number;
}

export interface AllGroupsOptions {
  maxConcurrency: number;
  /** Restrict to these groups. Omit for every group the API returns. */
  groupIds?: readonly GroupId[];
  onProgress?: (progress: AllGroupsProgress) => void;
}

export interface AllGroupsResult {
  workbook: Workbook;
  plan: ExportPlan;
  rows: MatrixExportRow[];
  /** Groups whose matrix could not be loaded at all, with the reason. */
  skipped: { groupId: GroupId; name: string; reason: string }[];
}

/**
 * Phase one: load every group's matrix and work out what the rest will cost.
 *
 * Group matrices are fetched with bounded concurrency; they share role grants,
 * so the cache does most of the work after the first few.
 */
export async function planAllGroupsExport(
  source: AllGroupsExportSource,
  options: AllGroupsOptions,
): Promise<{ plan: ExportPlan; skipped: AllGroupsResult['skipped'] }> {
  const listed = await source.listGroups();
  const wanted =
    options.groupIds === undefined
      ? listed
      : listed.filter((group) => options.groupIds?.includes(group.id) === true);

  options.onProgress?.({
    phase: 'planning',
    groupsDone: 0,
    groupsTotal: wanted.length,
    rowsSoFar: 0,
  });

  const skipped: AllGroupsResult['skipped'] = [];
  let done = 0;

  const settled = await mapWithConcurrency(wanted, options.maxConcurrency, async (group) => {
    try {
      const matrix = await source.getGroupMatrix(group.id);
      return matrix;
    } catch (cause) {
      // One unreadable group must not sink an org-wide export; it is recorded
      // and named on the Overview sheet instead.
      skipped.push({
        groupId: group.id,
        name: group.name,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
      return null;
    } finally {
      done += 1;
      options.onProgress?.({
        phase: 'planning',
        groupsDone: done,
        groupsTotal: wanted.length,
        currentGroup: group.name,
        rowsSoFar: 0,
      });
    }
  });

  const groups = settled.filter((matrix): matrix is GroupMatrix => matrix !== null);

  const roles = new Set<RoleId>();
  const pairs = new Set<string>();
  const objectTypes = new Set<ObjectTypeId>();
  for (const matrix of groups) {
    for (const roleAccess of matrix.roles) {
      roles.add(roleAccess.role.id);
      for (const objectType of roleAccess.objectTypes) {
        pairs.add(`${roleAccess.role.id}:${objectType.objectTypeId}`);
        objectTypes.add(objectType.objectTypeId);
      }
    }
  }

  return {
    plan: {
      groups,
      distinctRoles: roles.size,
      distinctPairs: pairs.size,
      distinctObjectTypes: objectTypes.size,
      // One permissions call per pair; exit requirements and the workflow
      // definition are per object type and shared across every role.
      estimatedRemainingCalls: pairs.size + objectTypes.size * 2,
    },
    skipped,
  };
}

/** Phase two: the per-pair drill-downs, then the workbook. */
export async function exportAllGroupsWorkbook(
  source: AllGroupsExportSource,
  options: AllGroupsOptions,
): Promise<AllGroupsResult> {
  const { plan, skipped } = await planAllGroupsExport(source, options);

  const fetchDetail: ObjectTypeDetailFetcher = (request) =>
    source.getObjectTypeDetail(request.roleId, request.objectTypeId);

  const rows: MatrixExportRow[] = [];
  let done = 0;

  // Groups are walked in sequence while their pairs fan out in parallel:
  // running whole groups concurrently as well would multiply the in-flight
  // requests past the configured ceiling.
  for (const matrix of plan.groups) {
    const groupRows = await buildMatrixRows(matrix, fetchDetail, {
      maxConcurrency: options.maxConcurrency,
    });
    appendAll(rows, groupRows);
    done += 1;
    options.onProgress?.({
      phase: 'fetching',
      groupsDone: done,
      groupsTotal: plan.groups.length,
      currentGroup: matrix.group.name,
      rowsSoFar: rows.length,
    });
  }

  options.onProgress?.({
    phase: 'writing',
    groupsDone: plan.groups.length,
    groupsTotal: plan.groups.length,
    rowsSoFar: rows.length,
  });

  assertFitsInSheet(rows.length);

  const workbook = createWorkbook();
  addOverviewSheet(workbook, plan, rows, skipped);
  addGroupsSheet(workbook, plan);
  addMatrixSheet(workbook, rows, { sheetName: 'Permissions' });

  return { workbook, plan, rows, skipped };
}

/**
 * Appends one array to another.
 *
 * NOT `target.push(...source)`: spreading passes every element as a separate
 * argument, and a single large group overflows the call stack. Found the hard
 * way on a 207-group run -- a five-group trial never got near the limit.
 */
export function appendAll<T>(target: T[], source: readonly T[]): void {
  for (const item of source) target.push(item);
}

/**
 * Excel's hard limit, header row included. Worth checking explicitly: writing
 * past it produces a file Excel refuses to open, which is a far worse outcome
 * than a clear failure naming the count.
 */
export const EXCEL_MAX_ROWS = 1_048_576;

/** Throws with a usable message rather than writing a file Excel will reject. */
export function assertFitsInSheet(rowCount: number): void {
  if (rowCount + 1 > EXCEL_MAX_ROWS) {
    throw new Error(
      `The permissions sheet would need ${rowCount.toLocaleString()} rows, past Excel's ` +
        `limit of ${EXCEL_MAX_ROWS.toLocaleString()}. Export in slices with --groups or --limit.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Sheets                                                                     */
/* -------------------------------------------------------------------------- */

const HEADER_FILL = 'FFEDEFF2';

function writeHeaderRow(sheet: Worksheet, headers: readonly string[]): void {
  const row = sheet.addRow([...headers]);
  row.font = { bold: true };
  for (let column = 1; column <= headers.length; column += 1) {
    row.getCell(column).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL },
    };
  }
  row.commit();
}

/**
 * Sheet 1: what the other sheets are, and when this was taken.
 *
 * Kept deliberately plain -- it is read once, by someone who did not run the
 * export and needs to know what they are looking at.
 */
export function addOverviewSheet(
  workbook: Workbook,
  plan: ExportPlan,
  rows: readonly MatrixExportRow[],
  skipped: AllGroupsResult['skipped'],
): Worksheet {
  const sheet = workbook.addWorksheet('Overview');
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 96;

  const title = sheet.addRow(['Resolver permission export']);
  title.font = { bold: true, size: 16 };

  const exportedAt = new Date();
  sheet.addRow(['Exported', exportedAt.toISOString()]);
  sheet.addRow(['Exported (local)', exportedAt.toString()]);
  sheet.addRow(['User groups', plan.groups.length]);
  sheet.addRow(['Distinct roles', plan.distinctRoles]);
  sheet.addRow(['Distinct object types', plan.distinctObjectTypes]);
  sheet.addRow(['Permission rows', rows.length]);

  // 207 groups against 173 on the Permissions sheet looks like data loss
  // until you know why, so the reconciliation is stated rather than left to
  // the reader. Group names are not unique either, which is why both sheets
  // carry ids.
  const withoutRoles = plan.groups.filter((matrix) => matrix.roles.length === 0).length;
  if (withoutRoles > 0) {
    sheet.addRow([
      'Groups with no roles',
      `${withoutRoles} — listed on User Groups, absent from Permissions because there is nothing to report. ` +
        `${plan.groups.length - withoutRoles} groups appear on Permissions.`,
    ]);
  }
  sheet.addRow([]);

  writeHeaderRow(sheet, ['Sheet', 'What it contains']);

  const describe = (name: string, text: string): void => {
    const row = sheet.addRow([name, text]);
    row.alignment = { wrapText: true, vertical: 'top' };
    row.height = 44;
  };

  describe(
    'Overview',
    'This sheet. Names the other sheets and records when the export was taken.',
  );
  describe(
    'User Groups',
    'One line per user group: its id, description, how many members and roles it has, and how many object types its roles can reach between them. Use it to find the group you care about, then filter the Permissions sheet by that group name.',
  );
  describe(
    'Permissions',
    'One line per group, role, object type, lifecycle and state, with what the role may do in that state. "Access" is the one-word summary (edit / read / none / unreported / unavailable / unknown); the Can columns break it out; the trigger columns say how many of the state\'s actions the role may fire, and name them. Designed as a PivotTable source.',
  );

  sheet.addRow([]);
  const caveat = sheet.addRow([
    'Reading it',
    'Access levels are reported by the Resolver API per state, not inferred. A blank Can cell means nothing was reported for that state, which is not the same as FALSE. "Object types reachable" on the User Groups sheet comes from lifecycle grants, which is a wider net than the per-state access on the Permissions sheet.',
  ]);
  caveat.alignment = { wrapText: true, vertical: 'top' };
  caveat.height = 44;

  if (skipped.length > 0) {
    sheet.addRow([]);
    const heading = sheet.addRow([`Groups skipped (${skipped.length})`, 'Reason']);
    heading.font = { bold: true };
    for (const entry of skipped) {
      sheet.addRow([`${entry.name} (${entry.groupId})`, entry.reason]);
    }
  }

  return sheet;
}

/** Sheet 2: every group and its headline numbers. */
export function addGroupsSheet(workbook: Workbook, plan: ExportPlan): Worksheet {
  const sheet = workbook.addWorksheet('User Groups');
  const headers = [
    'Group',
    'Group Id',
    'Description',
    '# Members',
    '# Roles',
    '# Object Types Reachable',
  ];
  writeHeaderRow(sheet, headers);

  const sorted = [...plan.groups].sort((a, b) => a.group.name.localeCompare(b.group.name));
  for (const matrix of sorted) {
    sheet.addRow([
      matrix.group.name,
      matrix.group.id,
      matrix.group.description ?? '',
      matrix.users.length,
      matrix.roles.length,
      matrix.objectTypeReach,
    ]);
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (sorted.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sorted.length + 1, column: headers.length },
    };
  }

  const widths = [40, 11, 70, 12, 10, 24];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  return sheet;
}
