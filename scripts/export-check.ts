/**
 * Builds a real .xlsx from the fixtures and reads it back with exceljs.
 *
 *   node scripts/export-check.ts
 *
 * Everything here runs against `MockResolverSource` -- no network, no API key.
 * The point is not that the export code runs, it is that the *file on disk*
 * contains the right values, so every assertion below is made against cells
 * parsed back out of the written workbook rather than against the in-memory
 * rows. A few assertions compare the two to catch a writer that drops columns.
 *
 * The expected counts are derived by hand from `src/server/data/mock/fixtures.ts`
 * and written as literals on purpose: a count computed from the same code under
 * test would pass vacuously.
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import ExcelJS from 'exceljs';
import type { Workbook, Worksheet } from 'exceljs';
import { MatrixRepository } from '../src/server/data/repository.ts';
import { MockResolverSource } from '../src/server/data/mockSource.ts';
import type { ResolverDataSource } from '../src/server/data/source.ts';
import { ResolverApiError } from '../src/server/http/resolverClient.ts';
import {
  MATRIX_COLUMNS,
  exportGroupWorkbook,
  sanitizeSheetName,
  writeWorkbookFile,
} from '../src/server/export/index.ts';
import type { ExportColumn } from '../src/server/export/index.ts';
import {
  exportAllGroupsWorkbook,
  planAllGroupsExport,
} from '../src/server/export/allGroups.ts';
import type { ApiRolePermissionRow } from '../src/server/types/resolver-api.ts';

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const OUT_DIR = 'node_modules/.tmp/export';
const GROUP_ID = 280774; // Incident Supervisor
const GROUP_NAME = 'Incident Supervisor';
/** The matrix sheet has a fixed name; the group is named on the Summary sheet. */
const MATRIX_SHEET = 'Permission Matrix';

/* -------------------------------------------------------------------------- */
/* Read-back helpers: a sheet as plain records keyed by header                 */
/* -------------------------------------------------------------------------- */

type CellValue = string | number | boolean | null;
type SheetRecord = Record<string, CellValue>;

function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  // Rich text / formula / date cells are not produced by this exporter; if one
  // appears, surface it as a string rather than silently coercing to null.
  return String(value);
}

function headersOf(sheet: Worksheet): string[] {
  const header = sheet.getRow(1);
  const headers: string[] = [];
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    headers.push(String(normalizeCell(header.getCell(column).value) ?? ''));
  }
  return headers;
}

function recordsOf(sheet: Worksheet): SheetRecord[] {
  const headers = headersOf(sheet);
  const records: SheetRecord[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record: SheetRecord = {};
    headers.forEach((header, position) => {
      record[header] = normalizeCell(row.getCell(position + 1).value);
    });
    records.push(record);
  }
  return records;
}

/** Writes the workbook out and parses the bytes back. */
async function roundTrip(
  workbook: Workbook,
  filePath: string,
  sheetName: string,
): Promise<Worksheet> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeWorkbookFile(workbook, filePath);

  const reread = new ExcelJS.Workbook();
  await reread.xlsx.readFile(filePath);
  const sheet = reread.getWorksheet(sheetName);
  if (sheet === undefined) {
    throw new Error(
      `sheet ${JSON.stringify(sheetName)} missing; got ${JSON.stringify(
        reread.worksheets.map((candidate) => candidate.name),
      )}`,
    );
  }
  return sheet;
}

/** Rows that describe an actual lifecycle state, as opposed to a note row. */
function stateRows(records: readonly SheetRecord[]): SheetRecord[] {
  return records.filter((record) => record['State'] !== null);
}

/* -------------------------------------------------------------------------- */
/* A source that counts calls per endpoint, so the budget is measured          */
/* -------------------------------------------------------------------------- */

interface CountingSource extends ResolverDataSource {
  counts: Record<string, number>;
  total(): number;
}

function countingSource(inner: ResolverDataSource): CountingSource {
  const counts: Record<string, number> = {
    userGroups: 0,
    groupRoles: 0,
    groupUsers: 0,
    objectTypes: 0,
    lifeCycles: 0,
    roleGrants: 0,
    statePermissions: 0,
    stateRequirements: 0,
    workflows: 0,
  };
  const bump = (key: string): void => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  return {
    counts,
    total: () => Object.values(counts).reduce((sum, value) => sum + value, 0),
    kind: inner.kind,
    get callCount() {
      return inner.callCount;
    },
    async fetchUserGroups() {
      bump('userGroups');
      return inner.fetchUserGroups();
    },
    async fetchGroupRoles() {
      bump('groupRoles');
      return inner.fetchGroupRoles();
    },
    async fetchGroupUsers() {
      bump('groupUsers');
      return inner.fetchGroupUsers();
    },
    async fetchObjectTypes() {
      bump('objectTypes');
      return inner.fetchObjectTypes();
    },
    async fetchObjectLifeCycles(includeStates: boolean) {
      bump('lifeCycles');
      return inner.fetchObjectLifeCycles(includeStates);
    },
    async fetchRoleLifeCyclePermissions(roleId: number) {
      bump('roleGrants');
      return inner.fetchRoleLifeCyclePermissions(roleId);
    },
    async fetchRoleObjectTypePermissions(roleId: number, objectTypeId: number) {
      bump('statePermissions');
      return inner.fetchRoleObjectTypePermissions(roleId, objectTypeId);
    },
    async fetchObjectTypeWorkflow(objectTypeId: number) {
      bump('workflows');
      return inner.fetchObjectTypeWorkflow(objectTypeId);
    },
    async fetchStateRequirements(objectTypeId: number) {
      bump('stateRequirements');
      return inner.fetchStateRequirements(objectTypeId);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 1. The happy path: one group, written and read back                         */
/* -------------------------------------------------------------------------- */

console.log('export: the workbook is written and parses back');

const source = countingSource(new MockResolverSource());
const repository = new MatrixRepository(source, 60_000, 6);
const exported = await exportGroupWorkbook(repository, GROUP_ID, { maxConcurrency: 6 });
const sheet = await roundTrip(exported.workbook, `${OUT_DIR}/matrix.xlsx`, MATRIX_SHEET);
const records = recordsOf(sheet);

check(
  'the workbook is Summary then the matrix',
  exported.workbook.worksheets.map((candidate) => candidate.name).join('|') ===
    'Summary|Permission Matrix',
  exported.workbook.worksheets.map((candidate) => candidate.name),
);

/**
 * The agreed column set, in the agreed order, as a literal. Deriving it from
 * `MATRIX_COLUMNS` would pass however that array changed, which is the one
 * thing this assertion exists to prevent.
 */
const EXPECTED_HEADERS = [
  'Group',
  'Role',
  'Object Type',
  'Lifecycle',
  'State',
  'Access',
  'Can Read',
  'Can Edit',
  'Can Create',
  'Can Delete',
  'Can Merge',
  'Can Manage',
  'Can Bulk Launch',
  '# Triggers Granted',
  '# Triggers Available',
  'Triggers Granted',
];

check(
  'the sheet carries exactly the agreed columns, in order',
  headersOf(sheet).join('|') === EXPECTED_HEADERS.join('|'),
  headersOf(sheet),
);
check(
  'and nothing was declared that the writer dropped',
  MATRIX_COLUMNS.map((column) => column.header).join('|') === EXPECTED_HEADERS.join('|'),
  MATRIX_COLUMNS.map((column) => column.header),
);
check(
  'every row names the group and role it belongs to',
  records.every((record) => record['Group'] === GROUP_NAME && record['Role'] !== null),
);
check('the sheet has rows at all', stateRows(records).length > 0, records.length);
check('in-memory rows and written rows agree', records.length === exported.rows.length, {
  written: records.length,
  built: exported.rows.length,
});

/* -------------------------------------------------------------------------- */
/* 2. Access: the one-word column, and the booleans beside it                  */
/* -------------------------------------------------------------------------- */

console.log('\nexport: access reads as one word, with booleans beside it');

const rowFor = (state: string): SheetRecord | undefined =>
  records.find((record) => record['Role'] === 'Incident Owner' && record['State'] === state);

const open = rowFor('Open');
const review = rowFor('Review');
const triage = rowFor('Triage');
const closed = rowFor('Closed');
const raised = rowFor('Raised');

check('an editable state reads "edit"', open?.['Access'] === 'edit', open?.['Access']);
check('a read-only state reads "read"', review?.['Access'] === 'read', review?.['Access']);
check('a denied state reads "none"', triage?.['Access'] === 'none', triage?.['Access']);
check(
  'a state with no reported row reads "unreported", not "none"',
  raised?.['Access'] === 'unreported',
  raised?.['Access'],
);

check(
  'read and edit are booleans that agree with the word',
  open?.['Can Read'] === true &&
    open['Can Edit'] === true &&
    review?.['Can Read'] === true &&
    review['Can Edit'] === false &&
    triage?.['Can Read'] === false &&
    triage['Can Edit'] === false,
  { open: open?.['Can Edit'], review: review?.['Can Edit'], triage: triage?.['Can Read'] },
);
check(
  'they are real booleans, not the text TRUE',
  typeof open?.['Can Read'] === 'boolean',
  typeof open?.['Can Read'],
);
check(
  'an unreported state leaves them blank rather than FALSE',
  raised?.['Can Read'] === null && raised['Can Edit'] === null,
  { read: raised?.['Can Read'], edit: raised?.['Can Edit'] },
);

check(
  'capability flags survive the round trip',
  open?.['Can Create'] === true &&
    open['Can Manage'] === true &&
    open['Can Delete'] === false &&
    open['Can Merge'] === false &&
    open['Can Bulk Launch'] === false,
  open,
);
check(
  'a capability held only on another state does not bleed across',
  closed?.['Can Merge'] === true && open?.['Can Merge'] === false,
  { closed: closed?.['Can Merge'], open: open?.['Can Merge'] },
);
check(
  'capabilities are blank, not FALSE, where nothing was reported',
  raised?.['Can Create'] === null && raised['Can Manage'] === null,
  raised,
);

/* -------------------------------------------------------------------------- */
/* 3. Triggers: granted out of available, by name                              */
/* -------------------------------------------------------------------------- */

console.log('\nexport: triggers are named and counted against the available set');

check(
  'granted triggers are counted against the available total',
  open?.['# Triggers Granted'] === 2 && open['# Triggers Available'] === 4,
  { granted: open?.['# Triggers Granted'], available: open?.['# Triggers Available'] },
);
check(
  'the granted ones are named',
  open?.['Triggers Granted'] === 'Escalate to Supervisor, Revert to Triage',
  open?.['Triggers Granted'],
);
check(
  'a state whose triggers the role does not hold shows 0 of N, not blank',
  triage?.['# Triggers Granted'] === 0 && triage['# Triggers Available'] === 2,
  { granted: triage?.['# Triggers Granted'], available: triage?.['# Triggers Available'] },
);
check(
  'a state with no triggers at all reports 0 available',
  closed?.['# Triggers Available'] === 0,
  closed?.['# Triggers Available'],
);

/* -------------------------------------------------------------------------- */
/* 4. The Summary sheet: which group, and what each role can do                */
/* -------------------------------------------------------------------------- */

console.log('\nexport: the summary sheet answers the two obvious questions');

/** A sheet as one string per row, cells separated by a character no cell holds. */
const CELL_SEPARATOR = '';

function linesOf(target: Worksheet): string[] {
  const lines: string[] = [];
  target.eachRow((row) => {
    lines.push(
      (row.values as unknown[])
        .slice(1)
        .map((value) => String(value ?? ''))
        .join(CELL_SEPARATOR),
    );
  });
  return lines;
}

const summarySheet = await roundTrip(exported.workbook, `${OUT_DIR}/matrix.xlsx`, 'Summary');
const summaryCells = linesOf(summarySheet);
const summaryText = summaryCells.join('\n');

check(
  'the group is named at the top',
  summaryCells[0]?.startsWith(`User group: ${GROUP_NAME}`) === true,
  summaryCells[0],
);
check(
  'with its id, membership and role counts',
  summaryText.includes('Group id') &&
    summaryText.includes('Members') &&
    summaryText.includes('Roles'),
);
check('and the grant-vs-reported caveat', summaryText.includes('wider net'));

const summaryHeaderIndex = summaryCells.findIndex((line) =>
  line.startsWith(`Role${CELL_SEPARATOR}`),
);
check('the per-role table has a header', summaryHeaderIndex > 0, summaryHeaderIndex);

const summaryRows = summaryCells
  .slice(summaryHeaderIndex + 1)
  .map((line) => line.split(CELL_SEPARATOR))
  .filter((cells) => cells[0] !== '');

check(
  'every role in the group appears',
  ['Incident Owner', 'Additional Access', 'Risk Champion'].every((role) =>
    summaryRows.some((cells) => cells[0] === role),
  ),
  summaryRows.map((cells) => cells[0]),
);

const incidentSummary = summaryRows.find(
  (cells) => cells[0] === 'Incident Owner' && cells[2] === 'Incident',
);
check(
  'a role/object-type line carries its per-level state counts',
  incidentSummary?.[4] === '2' && incidentSummary[5] === '2' && incidentSummary[6] === '1',
  incidentSummary,
);
check(
  'and its trigger totals, granted out of available',
  incidentSummary?.[9] === '3' && incidentSummary[10] === '9',
  { granted: incidentSummary?.[9], available: incidentSummary?.[10] },
);
check(
  'the summary state count agrees with the matrix sheet',
  Number(incidentSummary?.[8]) ===
    stateRows(records).filter(
      (record) => record['Role'] === 'Incident Owner' && record['Object Type'] === 'Incident',
    ).length,
  incidentSummary?.[8],
);

/* -------------------------------------------------------------------------- */
/* 6. A role that reaches nothing is still visible                             */
/* -------------------------------------------------------------------------- */

console.log('\nexport: a role with no reachable object types is not dropped');

const adminExport = await exportGroupWorkbook(
  new MatrixRepository(new MockResolverSource(), 60_000, 6),
  280773,
  { maxConcurrency: 6 },
);
const adminLines = linesOf(
  await roundTrip(adminExport.workbook, `${OUT_DIR}/admin.xlsx`, 'Summary'),
);
check(
  'it is listed with "(no object types)" rather than omitted',
  adminLines.some(
    (line) =>
      line.startsWith(`Command Center Portal${CELL_SEPARATOR}`) &&
      line.includes('(no object types)'),
  ),
  adminLines.filter((line) => line.includes('Command Center')),
);

/* -------------------------------------------------------------------------- */
/* 7. Degradation: a failed call must never read as "no access"                */
/* -------------------------------------------------------------------------- */

console.log('\nexport: failures are stated, not rendered as absence');

{
  const failing = new MockResolverSource();
  failing.fetchRoleObjectTypePermissions = async (): Promise<never> => {
    throw new ResolverApiError('Upstream 500 for role permissions', 500, '/data/rolePermissions');
  };
  const degraded = await exportGroupWorkbook(new MatrixRepository(failing, 60_000, 6), GROUP_ID, {
    maxConcurrency: 6,
  });
  const degradedRecords = stateRows(
    recordsOf(await roundTrip(degraded.workbook, `${OUT_DIR}/no-permissions.xlsx`, MATRIX_SHEET)),
  );

  check(
    'every state says "unavailable" rather than "none"',
    degradedRecords.length > 0 &&
      degradedRecords.every((record) => record['Access'] === 'unavailable'),
    [...new Set(degradedRecords.map((record) => record['Access']))],
  );
  check(
    'and the booleans stay blank rather than FALSE',
    degradedRecords.every((record) => record['Can Read'] === null && record['Can Edit'] === null),
  );
  check(
    'the summary names the failed call',
    linesOf(
      await roundTrip(degraded.workbook, `${OUT_DIR}/no-permissions.xlsx`, 'Summary'),
    ).some((line) => line.includes('permissions call failed')),
  );
}

{
  const noWorkflow = new MockResolverSource();
  noWorkflow.fetchObjectTypeWorkflow = async (): Promise<never> => {
    throw new ResolverApiError('Upstream 500 for workflow', 500, '/object/objectType');
  };
  const degraded = await exportGroupWorkbook(
    new MatrixRepository(noWorkflow, 60_000, 6),
    GROUP_ID,
    { maxConcurrency: 6 },
  );
  const openRow = recordsOf(
    await roundTrip(degraded.workbook, `${OUT_DIR}/no-workflow.xlsx`, MATRIX_SHEET),
  ).find((record) => record['Role'] === 'Incident Owner' && record['State'] === 'Open');

  check(
    'without the workflow, the granted triggers are still counted',
    openRow?.['# Triggers Granted'] === 2,
    openRow?.['# Triggers Granted'],
  );
  check(
    'but they fall back to ids, and available cannot exceed what is known',
    String(openRow?.['Triggers Granted']).startsWith('Trigger ') &&
      openRow?.['# Triggers Available'] === 2,
    { names: openRow?.['Triggers Granted'], available: openRow?.['# Triggers Available'] },
  );
  check(
    'and the summary says the workflow call failed',
    linesOf(await roundTrip(degraded.workbook, `${OUT_DIR}/no-workflow.xlsx`, 'Summary')).some(
      (line) => line.includes('workflow call failed'),
    ),
  );
}

{
  const oddLevel = new MockResolverSource();
  oddLevel.fetchRoleObjectTypePermissions = async (): Promise<ApiRolePermissionRow[]> => [
    {
      id: 1,
      permission: 7,
      canBulkLaunch: false,
      canCreate: false,
      canDelete: false,
      canMerge: false,
      canManageRole: false,
      roleId: 449698,
      objectTypeId: 450001,
      objectLifeCycleId: 603174,
      objectLifeCycleStateId: 60317401,
      formId: null,
      org: 1,
      externalRefId: 'odd',
      assigned: false,
    },
  ];
  const oddExport = await exportGroupWorkbook(
    new MatrixRepository(oddLevel, 60_000, 6),
    GROUP_ID,
    { maxConcurrency: 6 },
  );
  const oddRow = recordsOf(
    await roundTrip(oddExport.workbook, `${OUT_DIR}/odd.xlsx`, MATRIX_SHEET),
  ).find((record) => record['Role'] === 'Incident Owner' && record['State'] === 'Open');

  check('an unrecognised level reads "unknown"', oddRow?.['Access'] === 'unknown', oddRow?.['Access']);
  check(
    'and is not guessed at as read or edit',
    oddRow?.['Can Read'] === null && oddRow['Can Edit'] === null,
    { read: oddRow?.['Can Read'], edit: oddRow?.['Can Edit'] },
  );
}

/* -------------------------------------------------------------------------- */
/* 8. Cost, measured                                                           */
/* -------------------------------------------------------------------------- */

console.log('\nexport: the call budget is what the docs claim');

check('a cold one-group export costs 19 upstream calls', source.total() === 19, source.counts);
check(
  'made up of 5 collection/catalog, 3 roles, 5 pairs, and 3 + 3 per object type',
  source.counts['userGroups'] === 1 &&
    source.counts['objectTypes'] === 1 &&
    source.counts['roleGrants'] === 3 &&
    source.counts['statePermissions'] === 5 &&
    source.counts['stateRequirements'] === 3 &&
    source.counts['workflows'] === 3,
  source.counts,
);

const callsBefore = source.total();
await exportGroupWorkbook(repository, GROUP_ID, { maxConcurrency: 6 });
check('a second export of the same group is free', source.total() === callsBefore, {
  before: callsBefore,
  after: source.total(),
});

/* -------------------------------------------------------------------------- */
/* 9. The column set is declarative                                            */
/* -------------------------------------------------------------------------- */

console.log('\nexport: adding a column touches only the column array');

{
  const extra: ExportColumn = {
    header: 'Added Later',
    key: 'addedLater',
    width: 12,
    value: (row) => row.state?.name ?? null,
  };
  const widened = await exportGroupWorkbook(repository, GROUP_ID, {
    maxConcurrency: 6,
    columns: [...MATRIX_COLUMNS, extra],
  });
  const widenedSheet = await roundTrip(widened.workbook, `${OUT_DIR}/widened.xlsx`, MATRIX_SHEET);
  const widenedHeaders = headersOf(widenedSheet);
  check(
    'the new column appears last, carrying its values',
    widenedHeaders[widenedHeaders.length - 1] === 'Added Later' &&
      recordsOf(widenedSheet).every((record) => record['Added Later'] === record['State']),
  );
}

check(
  'sheet names are sanitized to Excel rules',
  sanitizeSheetName('a/b:c*d?e[f]g') === 'a b c d e f g',
  sanitizeSheetName('a/b:c*d?e[f]g'),
);
check(
  'and truncated to 31 characters',
  sanitizeSheetName('x'.repeat(40)).length === 31,
  sanitizeSheetName('x'.repeat(40)).length,
);


/* -------------------------------------------------------------------------- */
/* 10. The master workbook: every group in one file                            */
/* -------------------------------------------------------------------------- */

console.log('\nexport: the master workbook covers every group');

{
  const masterSource = countingSource(new MockResolverSource());
  const masterRepo = new MatrixRepository(masterSource, 60_000, 6);

  // The plan phase must be able to state the cost before spending it.
  const planned = await planAllGroupsExport(masterRepo, { maxConcurrency: 6 });
  check('planning finds every fixture group', planned.plan.groups.length === 3, {
    groups: planned.plan.groups.length,
  });
  check(
    'a role in two groups is counted once',
    planned.plan.distinctRoles === 5,
    planned.plan.distinctRoles,
  );
  check(
    'the remaining cost is pairs plus two per object type',
    planned.plan.estimatedRemainingCalls ===
      planned.plan.distinctPairs + planned.plan.distinctObjectTypes * 2,
    planned.plan,
  );
  const afterPlanning = masterSource.total();
  check(
    'and planning itself spends no per-pair call',
    masterSource.counts['statePermissions'] === 0,
    masterSource.counts,
  );

  const master = await exportAllGroupsWorkbook(masterRepo, { maxConcurrency: 6 });
  const masterPath = `${OUT_DIR}/all-groups.xlsx`;

  check(
    'the sheets are Overview, User Groups, Permissions in that order',
    master.workbook.worksheets.map((s) => s.name).join('|') ===
      'Overview|User Groups|Permissions',
    master.workbook.worksheets.map((s) => s.name),
  );
  check(
    'the fetch phase spent what the plan predicted',
    masterSource.total() - afterPlanning === planned.plan.estimatedRemainingCalls,
    { spent: masterSource.total() - afterPlanning, planned: planned.plan.estimatedRemainingCalls },
  );

  const overview = linesOf(await roundTrip(master.workbook, masterPath, 'Overview'));
  const overviewText = overview.join('\n');
  check('the overview is titled', overview[0]?.includes('Resolver permission export') === true);
  check(
    'it records when the export was taken',
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(overviewText),
  );
  check(
    'it describes every other sheet by name',
    overviewText.includes('User Groups') &&
      overviewText.includes('Permissions') &&
      overviewText.includes('One line per user group'),
  );
  check(
    'and carries the blank-is-not-false caveat',
    overviewText.includes('not the same as FALSE'),
  );

  const groupsSheet = await roundTrip(master.workbook, masterPath, 'User Groups');
  const groupRecords = recordsOf(groupsSheet);
  check('every group has a line', groupRecords.length === 3, groupRecords.length);
  check(
    'with the stats asked for',
    headersOf(groupsSheet).join('|') ===
      'Group|Group Id|Description|# Members|# Roles|# Object Types Reachable',
    headersOf(groupsSheet),
  );
  const supervisor = groupRecords.find((record) => record['Group'] === GROUP_NAME);
  check(
    'and the numbers match the matrix',
    supervisor?.['Group Id'] === GROUP_ID &&
      supervisor['# Members'] === 3 &&
      supervisor['# Roles'] === 3 &&
      supervisor['# Object Types Reachable'] === 3,
    supervisor,
  );

  const permissions = await roundTrip(master.workbook, masterPath, 'Permissions');
  const permissionRecords = recordsOf(permissions);
  check(
    'the permissions sheet uses the same columns as a single-group export',
    headersOf(permissions).join('|') === EXPECTED_HEADERS.join('|'),
    headersOf(permissions),
  );
  const groupsInSheet = new Set(permissionRecords.map((record) => record['Group']));
  check('it spans every group, not just one', groupsInSheet.size === 3, [...groupsInSheet]);
  check(
    'and a known row survives the wider export',
    permissionRecords.some(
      (record) =>
        record['Group'] === GROUP_NAME &&
        record['Role'] === 'Incident Owner' &&
        record['State'] === 'Open' &&
        record['Access'] === 'edit' &&
        record['# Triggers Granted'] === 2,
    ),
  );
}

{
  // One unreadable group must not sink the whole export.
  const brittle = new MockResolverSource();
  const realGroupRoles = brittle.fetchGroupRoles.bind(brittle);
  brittle.fetchGroupRoles = async () => {
    const roles = await realGroupRoles();
    // Group 280775 loses its roles entirely, which makes its matrix unbuildable
    // only if the repository throws; here it simply has none, so instead we
    // break the group's users to force a failure path in getGroupMatrix.
    return roles;
  };
  const failingRepo = new MatrixRepository(brittle, 60_000, 6);
  const original = failingRepo.getGroupMatrix.bind(failingRepo);
  failingRepo.getGroupMatrix = async (groupId: number) => {
    if (groupId === 280775) throw new ResolverApiError('Upstream 500', 500, '/user/group');
    return original(groupId);
  };

  const partial = await exportAllGroupsWorkbook(failingRepo, { maxConcurrency: 6 });
  check('the other groups still export', partial.plan.groups.length === 2, partial.plan.groups.length);
  check('the failure is recorded, not swallowed', partial.skipped.length === 1, partial.skipped);
  const overview = linesOf(
    await roundTrip(partial.workbook, `${OUT_DIR}/all-groups-partial.xlsx`, 'Overview'),
  );
  check(
    'and named on the overview sheet',
    overview.some((line) => line.includes('Groups skipped')) &&
      overview.some((line) => line.includes('Risk & Compliance')),
    overview.filter((line) => line.toLowerCase().includes('skip')),
  );
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
