/**
 * The two human-readable sheets: Summary and Members.
 *
 * The matrix sheet is built for PivotTables, which makes it unreadable at a
 * glance -- 40-odd columns and a row per state. These sheets answer the two
 * questions someone opening the file actually has: *which group is this?* and
 * *what can each role in it do?* The matrix is then there for anyone who wants
 * to slice further.
 *
 * Unlike `workbook.ts`, this module knows the domain: it reads the group
 * matrix and the already-built rows rather than a generic column array.
 */
import type { Workbook, Worksheet } from 'exceljs';
import type { GroupMatrix, ObjectTypeAccessDetail } from '../../shared/types/domain.ts';
import type { MatrixExportRow } from './types.ts';
import { sanitizeSheetName } from './workbook.ts';

const LABEL_WIDTH = 26;
const HEADER_FILL = 'FFEDEFF2';

/** One (role, object type) line of the summary table. */
interface RoleObjectTypeSummary {
  roleName: string;
  roleIsGlobal: boolean;
  objectTypeName: string;
  coverage: string;
  readWrite: number;
  read: number;
  none: number;
  unreported: number;
  totalStates: number;
  triggersGranted: number;
  triggersAvailable: number;
  issue: string;
}

/**
 * Collapses the per-state rows back up to one line per (role, object type).
 *
 * Built from the same rows the matrix sheet uses, so the two sheets cannot
 * disagree -- recomputing from the source would let them drift.
 * O(rows).
 */
function summarize(rows: readonly MatrixExportRow[]): RoleObjectTypeSummary[] {
  const byKey = new Map<string, RoleObjectTypeSummary>();

  for (const row of rows) {
    if (row.objectType === null) continue;
    const key = `${row.role.id}:${row.objectType.objectTypeId}`;

    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = {
        roleName: row.role.name,
        roleIsGlobal: row.role.isGlobal,
        objectTypeName: row.objectType.name,
        coverage: row.objectType.coverage,
        readWrite: 0,
        read: 0,
        none: 0,
        unreported: 0,
        totalStates: 0,
        triggersGranted: 0,
        triggersAvailable: 0,
        issue: describeIssue(row.objectType),
      };
      byKey.set(key, entry);
    }

    const state = row.state;
    if (state === null) continue;
    entry.totalStates += 1;
    entry.triggersAvailable += state.triggers.length;
    entry.triggersGranted += state.triggers.filter((trigger) => trigger.granted).length;

    if (state.permission === null) {
      entry.unreported += 1;
      continue;
    }
    switch (state.permission.level) {
      case 'read-write':
        entry.readWrite += 1;
        break;
      case 'read':
        entry.read += 1;
        break;
      case 'none':
        entry.none += 1;
        break;
      default:
        // An unrecognised level is neither access nor its absence; it is
        // called out in the issue column rather than silently bucketed.
        entry.unreported += 1;
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      a.roleName.localeCompare(b.roleName) || a.objectTypeName.localeCompare(b.objectTypeName),
  );
}

/** Anything about this drill-down the reader should not have to infer. */
function describeIssue(objectType: ObjectTypeAccessDetail): string {
  const issues: string[] = [];
  if (objectType.permissionsError !== null) issues.push('permissions call failed');
  if (objectType.requirementsError !== null) issues.push('requirements call failed');
  if (objectType.triggersError !== null) issues.push('workflow call failed');
  if (objectType.permissionSummary.unknown > 0) {
    issues.push(`${objectType.permissionSummary.unknown} unrecognised level(s)`);
  }
  if (objectType.permissionSummary.unmatchedReportedRows > 0) {
    issues.push(`${objectType.permissionSummary.unmatchedReportedRows} unplaceable row(s)`);
  }
  return issues.join('; ');
}

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
 * Adds the Summary sheet: which group this is, then a line per role and
 * object type saying what the role can do.
 */
export function addSummarySheet(
  workbook: Workbook,
  matrix: GroupMatrix,
  rows: readonly MatrixExportRow[],
): Worksheet {
  const sheet = workbook.addWorksheet('Summary');
  sheet.getColumn(1).width = LABEL_WIDTH;

  const title = sheet.addRow([`User group: ${matrix.group.name}`]);
  title.font = { bold: true, size: 14 };

  sheet.addRow(['Group id', matrix.group.id]);
  sheet.addRow(['Description', matrix.group.description ?? '—']);
  sheet.addRow(['Members', matrix.users.length]);
  sheet.addRow(['Roles', matrix.roles.length]);
  sheet.addRow(['Object types reachable', matrix.objectTypeReach]);
  sheet.addRow(['Exported', new Date().toISOString()]);
  sheet.addRow([]);

  // The inference caveat belongs next to the numbers it qualifies.
  const note = sheet.addRow([
    'How to read this',
    'Access levels below are reported by the Resolver API per state. "Object types reachable" comes from the role\'s lifecycle grants, which is a wider net than the per-state access.',
  ]);
  note.alignment = { wrapText: true, vertical: 'top' };
  note.height = 30;
  sheet.addRow([]);

  const headers = [
    'Role',
    'Global role',
    'Object type',
    'Lifecycle coverage',
    'States: read & edit',
    'States: read only',
    'States: no access',
    'States: not reported',
    'States total',
    'Triggers granted',
    'Triggers available',
    'Issues',
  ];
  writeHeaderRow(sheet, headers);

  const summaries = summarize(rows);
  for (const entry of summaries) {
    sheet.addRow([
      entry.roleName,
      entry.roleIsGlobal,
      entry.objectTypeName,
      entry.coverage,
      entry.readWrite,
      entry.read,
      entry.none,
      entry.unreported,
      entry.totalStates,
      entry.triggersGranted,
      entry.triggersAvailable,
      entry.issue,
    ]);
  }

  // Roles reaching nothing would otherwise vanish from the summary entirely.
  for (const roleAccess of matrix.roles) {
    if (roleAccess.objectTypes.length > 0) continue;
    sheet.addRow([
      roleAccess.role.name,
      roleAccess.role.isGlobal,
      '(no object types)',
      'none',
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      roleAccess.grantsError === null ? '' : `grants call failed: ${roleAccess.grantsError}`,
    ]);
  }

  const tableHeaderRowNumber = sheet.rowCount - summaries.length;
  sheet.views = [{ state: 'frozen', ySplit: tableHeaderRowNumber }];
  sheet.autoFilter = {
    from: { row: tableHeaderRowNumber, column: 1 },
    to: { row: sheet.rowCount, column: headers.length },
  };

  const widths = [30, 11, 30, 17, 17, 16, 16, 18, 12, 15, 16, 34];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  return sheet;
}

/** Adds the Members sheet: who is in the group. */
export function addMembersSheet(workbook: Workbook, matrix: GroupMatrix): Worksheet {
  const sheet = workbook.addWorksheet(sanitizeSheetName('Members'));
  const headers = ['Name', 'Email', 'Active', 'Admin', 'User type', 'Last login'];
  writeHeaderRow(sheet, headers);

  for (const user of matrix.users) {
    sheet.addRow([
      user.fullName,
      user.email,
      user.isActive,
      user.isAdmin,
      user.userType,
      user.lastLogin ?? '',
    ]);
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const widths = [28, 34, 9, 9, 11, 26];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  return sheet;
}
