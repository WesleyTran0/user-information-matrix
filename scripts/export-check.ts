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

function countWhere(records: readonly SheetRecord[], header: string, value: CellValue): number {
  return records.filter((record) => record[header] === value).length;
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
const sheet = await roundTrip(exported.workbook, `${OUT_DIR}/matrix.xlsx`, 'Permission Matrix');
const records = recordsOf(sheet);

// Summary leads so Excel opens on something readable; the matrix is the pivot
// source behind it.
check(
  'the workbook leads with Summary, then the matrix, then Members',
  exported.workbook.worksheets.map((candidate) => candidate.name).join('|') ===
    'Summary|Permission Matrix|Members',
  exported.workbook.worksheets.map((candidate) => candidate.name),
);
check(
  'every declared column reached the file, in order',
  headersOf(sheet).join('|') === MATRIX_COLUMNS.map((column) => column.header).join('|'),
  headersOf(sheet),
);
check(
  'the column set is substantial, so the header check is not trivial',
  MATRIX_COLUMNS.length >= 20,
  MATRIX_COLUMNS.length,
);
check(
  'the six identity columns lead, in the agreed order',
  headersOf(sheet).slice(0, 5).join('|') === 'Group|Group Id|Role|Role Id|Role Is Global',
  headersOf(sheet).slice(0, 5),
);

// 3 roles: Additional Access (8 rows), Incident Owner (4 + 8), Risk Champion
// (3 + 8 state rows + 2 unattributable-grant note rows) = 33.
check('33 data rows, hand-counted from the fixtures', records.length === 33, records.length);
check('the file agrees with the in-memory rows', records.length === exported.rows.length, {
  file: records.length,
  memory: exported.rows.length,
});
check('31 of them describe a real state', stateRows(records).length === 31, stateRows(records).length);

check(
  'every row carries the group identity',
  records.every((record) => record['Group'] === GROUP_NAME && record['Group Id'] === GROUP_ID),
);
check(
  'all three roles appear',
  new Set(records.map((record) => record['Role'])).size === 3,
  [...new Set(records.map((record) => record['Role']))],
);

/* -------------------------------------------------------------------------- */
/* 1b. The Summary sheet: which group, and what each role can do              */
/* -------------------------------------------------------------------------- */

console.log('\nexport: the summary sheet answers the two obvious questions');

const summarySheet = await roundTrip(exported.workbook, `${OUT_DIR}/matrix.xlsx`, 'Summary');
const summaryCells: string[] = [];
summarySheet.eachRow((row) => {
  const values = (row.values as unknown[]).slice(1).map((value) => String(value ?? ''));
  summaryCells.push(values.join('\u0001'));
});
const summaryText = summaryCells.join('\n');

check(
  'the group is named at the top',
  summaryCells[0]?.startsWith(`User group: ${GROUP_NAME}`) === true,
  summaryCells[0],
);
check('the group id is stated', summaryText.includes('Group id'), false);
check(
  'membership and role counts are stated',
  summaryText.includes('Members') && summaryText.includes('Roles'),
);
check(
  'the grant-vs-reported caveat travels with the numbers',
  summaryText.includes('wider net'),
);

const summaryHeaderIndex = summaryCells.findIndex((line) => line.startsWith('Role\u0001'));
check('the per-role table has a header', summaryHeaderIndex > 0, summaryHeaderIndex);

const summaryRows = summaryCells
  .slice(summaryHeaderIndex + 1)
  .map((line) => line.split('\u0001'))
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
  'the summary counts agree with the matrix sheet',
  Number(incidentSummary?.[8]) ===
    stateRows(records).filter(
      (record) => record['Role'] === 'Incident Owner' && record['Object Type'] === 'Incident',
    ).length,
  incidentSummary?.[8],
);

// Group 280774 has no such role, so this is checked against 280773, where
// Command Center Portal holds no grants at all.
const adminExport = await exportGroupWorkbook(
  new MatrixRepository(new MockResolverSource(), 60_000, 6),
  280773,
  { maxConcurrency: 6 },
);
const adminSummary = await roundTrip(
  adminExport.workbook,
  `${OUT_DIR}/admin.xlsx`,
  'Summary',
);
const adminLines: string[] = [];
adminSummary.eachRow((row) => {
  adminLines.push((row.values as unknown[]).slice(1).map((v) => String(v ?? '')).join('\u0001'));
});
check(
  'a role that reaches nothing is still listed, not dropped',
  adminLines.some((line) => line.startsWith('Command Center Portal\u0001') &&
    line.includes('(no object types)')),
  adminLines.filter((line) => line.includes('Command Center')),
);

/* -------------------------------------------------------------------------- */
/* 1c. The Members sheet                                                      */
/* -------------------------------------------------------------------------- */

console.log('\nexport: the members sheet lists the group');

const membersSheet = await roundTrip(exported.workbook, `${OUT_DIR}/matrix.xlsx`, 'Members');
const memberRecords = recordsOf(membersSheet);
check('every member is listed', memberRecords.length === exported.matrix.users.length,
  { sheet: memberRecords.length, matrix: exported.matrix.users.length });
check(
  'with the fields that identify them',
  memberRecords.every((record) => record['Name'] !== '' && record['Email'] !== ''),
);

/* -------------------------------------------------------------------------- */
/* 2. Partial coverage: Incident owns two lifecycles, one granted             */
/* -------------------------------------------------------------------------- */

console.log('\nexport: partial coverage is visible per state');

const additionalAccessIncident = records.filter(
  (record) => record['Role'] === 'Additional Access' && record['Object Type'] === 'Incident',
);
check(
  'Additional Access on Incident spans both lifecycles (8 states)',
  additionalAccessIncident.length === 8,
  additionalAccessIncident.length,
);
check(
  'the granted lifecycle covers 5 states, the other 3',
  countWhere(additionalAccessIncident, 'Grant Covers State', true) === 5 &&
    countWhere(additionalAccessIncident, 'Grant Covers State', false) === 3,
  additionalAccessIncident.map((record) => [record['Lifecycle'], record['Grant Covers State']]),
);
check(
  'coverage is reported as partial on every one of those rows',
  additionalAccessIncident.every((record) => record['Coverage'] === 'partial'),
);
check(
  'the roll-up columns carry 1 of 2 lifecycles and 5 of 8 states',
  additionalAccessIncident.every(
    (record) =>
      record['Granted Lifecycles'] === 1 &&
      record['Total Lifecycles'] === 2 &&
      record['Granted States'] === 5 &&
      record['Total States'] === 8,
  ),
  additionalAccessIncident[0],
);
check(
  'grant coverage is TRUE on 22 rows across the sheet',
  countWhere(records, 'Grant Covers State', true) === 22,
  countWhere(records, 'Grant Covers State', true),
);

/* -------------------------------------------------------------------------- */
/* 3. The headline column: grants that claim more than the API delivers       */
/* -------------------------------------------------------------------------- */

console.log('\nexport: Grant Overstates isolates the discrepancy');

const overstating = records.filter((record) => record['Grant Overstates'] === true);
check('exactly one row overstates in this group', overstating.length === 1, overstating.length);

const offender = overstating[0];
check(
  'it is Incident Owner, Incident Workflow, Triage',
  offender?.['Role'] === 'Incident Owner' &&
    offender['Object Type'] === 'Incident' &&
    offender['Lifecycle'] === 'Incident Workflow' &&
    offender['State'] === 'Triage',
  offender,
);
check(
  'that row holds the grant but reports no access at level 0',
  offender?.['Grant Covers State'] === true &&
    offender['Reported Access'] === 'No access' &&
    offender['Reported Level'] === 0,
  offender,
);
check(
  'it is a real boolean, not the text "TRUE"',
  typeof offender?.['Grant Overstates'] === 'boolean',
  typeof offender?.['Grant Overstates'],
);
check(
  'rows that were verified and agree read FALSE, not blank',
  countWhere(records, 'Grant Overstates', false) === 13,
  countWhere(records, 'Grant Overstates', false),
);
check(
  'unverifiable rows are blank rather than a false negative',
  countWhere(records, 'Grant Overstates', null) === 19,
  countWhere(records, 'Grant Overstates', null),
);

/* -------------------------------------------------------------------------- */
/* 4. Reported access, capabilities, triggers, requirements                   */
/* -------------------------------------------------------------------------- */

console.log('\nexport: reported permissions land in the cells');

check(
  'reported levels are counted as the fixtures encode them',
  countWhere(records, 'Reported Access', 'Read & write') === 4 &&
    countWhere(records, 'Reported Access', 'Read only') === 9 &&
    countWhere(records, 'Reported Access', 'No access') === 1 &&
    countWhere(records, 'Reported Access', 'Not reported') === 17,
  {
    readWrite: countWhere(records, 'Reported Access', 'Read & write'),
    read: countWhere(records, 'Reported Access', 'Read only'),
    none: countWhere(records, 'Reported Access', 'No access'),
    unreported: countWhere(records, 'Reported Access', 'Not reported'),
  },
);
check(
  'no state row leaves Reported Access blank',
  stateRows(records).every((record) => record['Reported Access'] !== null),
);

const openState = records.find(
  (record) => record['Role'] === 'Incident Owner' && record['State'] === 'Open',
);
check(
  'capability flags survive the round trip',
  openState?.['Can Create'] === true &&
    openState['Can Manage Role'] === true &&
    openState['Can Delete'] === false &&
    openState['Can Merge'] === false &&
    openState['Can Bulk Launch'] === false,
  openState,
);
check(
  'granted triggers are counted against the available total',
  openState?.['Triggers Granted'] === 2 && openState['Triggers Available'] === 4,
  { granted: openState?.['Triggers Granted'], available: openState?.['Triggers Available'] },
);
check(
  'triggers are named, on both sides of the split',
  openState?.['Trigger Names (granted)'] === 'Escalate to Supervisor, Revert to Triage' &&
    String(openState['Trigger Names (not granted)']).includes('Overdue Reminder'),
  {
    granted: openState?.['Trigger Names (granted)'],
    other: openState?.['Trigger Names (not granted)'],
  },
);
check(
  'and the ids remain as a join key, aligned with the names',
  // Same order as the names column, so the Nth id is the Nth name.
  openState?.['Trigger Ids (granted)'] === '9005, 9003',
  openState?.['Trigger Ids (granted)'],
);

const investigation = records.find(
  (record) => record['Role'] === 'Incident Owner' && record['State'] === 'Investigation',
);
check(
  'state requirements land on the right state',
  investigation?.['Requires Fields'] === 1 &&
    investigation['Requires Roles'] === 1 &&
    investigation['Requires Other'] === 0,
  investigation,
);
check(
  'requirements are shared across roles for the same object type (6 field rows, 3 role rows)',
  countWhere(records, 'Requires Fields', 1) === 6 && countWhere(records, 'Requires Roles', 1) === 3,
  {
    fields: countWhere(records, 'Requires Fields', 1),
    roles: countWhere(records, 'Requires Roles', 1),
  },
);
check(
  'a state with nothing required reads 0, not blank -- the call did answer',
  countWhere(records, 'Requires Fields', 0) === 25 &&
    stateRows(records).every((record) => record['Requires Fields'] !== null),
  countWhere(records, 'Requires Fields', 0),
);

console.log('\nexport: per-object-type data-quality roll-ups');

check(
  'the overstated roll-up marks all 8 rows of the offending block',
  countWhere(records, 'Overstated States', 1) === 8,
  countWhere(records, 'Overstated States', 1),
);
check(
  'and reads 0, not blank, on the state rows of clean blocks',
  countWhere(records, 'Overstated States', 0) === 23,
  countWhere(records, 'Overstated States', 0),
);
check(
  'nothing was reported that could not be placed against a state',
  stateRows(records).every(
    (record) =>
      record['Unmatched Reported Rows'] === 0 &&
      record['Duplicate Reported Rows'] === 0 &&
      // exceljs may store an empty string as an empty cell; either is "none".
      (record['Unmatched Lifecycle Ids'] === null ||
        record['Unmatched Lifecycle Ids'] === ''),
  ),
  stateRows(records).find((record) => record['Unmatched Reported Rows'] !== 0),
);
check(
  'the clean run reports no understated or unknown-level states',
  countWhere(records, 'Grant Understates', true) === 0 &&
    stateRows(records).every((record) => record['Unknown Level States'] === 0),
);
check(
  'and no requirements call failed',
  records.every((record) => record['Requirements Error'] === null),
);

/* -------------------------------------------------------------------------- */
/* 5. Data gaps are rows, not silence                                         */
/* -------------------------------------------------------------------------- */

console.log('\nexport: gaps are written down');

const unattributable = records.filter(
  (record) =>
    typeof record['Note'] === 'string' && record['Note'].includes('not attributable to any object type'),
);
check('both unattributable grants get a row', unattributable.length === 2, unattributable.length);
check(
  'they are attributed to Risk Champion and name the lifecycle ids',
  unattributable.every((record) => record['Role'] === 'Risk Champion') &&
    unattributable.some((record) => String(record['Note']).includes('888888')) &&
    unattributable.some((record) => String(record['Note']).includes('999001')),
  unattributable.map((record) => record['Note']),
);

/* -------------------------------------------------------------------------- */
/* 6. "No access", "Not reported" and a failed call stay three things         */
/* -------------------------------------------------------------------------- */

console.log('\nexport: the three negative outcomes never collapse');

{
  const failing = new MockResolverSource();
  const inner = failing.fetchRoleObjectTypePermissions.bind(failing);
  // Fail the permissions call for one role only, so a single sheet holds all
  // three outcomes at once.
  failing.fetchRoleObjectTypePermissions = async (roleId: number, objectTypeId: number) => {
    if (roleId === 449710) {
      throw new ResolverApiError(
        'Upstream 500 for /data/rolePermissions',
        500,
        '/data/rolePermissions',
      );
    }
    return inner(roleId, objectTypeId);
  };

  const degradedRepo = new MatrixRepository(failing, 60_000, 6);
  const degraded = await exportGroupWorkbook(degradedRepo, GROUP_ID, { maxConcurrency: 6 });
  const degradedSheet = await roundTrip(degraded.workbook, `${OUT_DIR}/degraded.xlsx`, MATRIX_SHEET);
  const degradedRecords = recordsOf(degradedSheet);

  check(
    'the sheet still has all 33 rows',
    degradedRecords.length === 33,
    degradedRecords.length,
  );
  check(
    'all three outcomes appear, with distinct wording',
    countWhere(degradedRecords, 'Reported Access', 'No access') === 1 &&
      countWhere(degradedRecords, 'Reported Access', 'Not reported') === 14 &&
      countWhere(degradedRecords, 'Reported Access', 'Permissions unavailable') === 8,
    {
      none: countWhere(degradedRecords, 'Reported Access', 'No access'),
      unreported: countWhere(degradedRecords, 'Reported Access', 'Not reported'),
      unavailable: countWhere(degradedRecords, 'Reported Access', 'Permissions unavailable'),
    },
  );
  check(
    'not one of them is an empty cell',
    stateRows(degradedRecords).every((record) => record['Reported Access'] !== null),
  );
  check(
    'the failed call is named in its own column',
    degradedRecords
      .filter((record) => record['Reported Access'] === 'Permissions unavailable')
      .every((record) => String(record['Permissions Error']).includes('500')),
  );
  check(
    'and the successful roles carry no error',
    degradedRecords
      .filter((record) => record['Reported Access'] === 'No access')
      .every((record) => record['Permissions Error'] === null),
  );
  check(
    'a failed call never reads as an overstated grant',
    degradedRecords
      .filter((record) => record['Reported Access'] === 'Permissions unavailable')
      .every((record) => record['Grant Overstates'] === null),
  );
}

/* -------------------------------------------------------------------------- */
/* 6b. Grant Understates, and an access level we cannot read                  */
/* -------------------------------------------------------------------------- */

console.log('\nexport: the grant is wrong in the other direction too');

/** Serves the fixtures plus extra permission rows for chosen pairs. */
function sourceWithExtraRows(extra: Record<string, ApiRolePermissionRow[]>): MockResolverSource {
  const patched = new MockResolverSource();
  const inner = patched.fetchRoleObjectTypePermissions.bind(patched);
  patched.fetchRoleObjectTypePermissions = async (roleId: number, objectTypeId: number) => {
    const rows = await inner(roleId, objectTypeId);
    return [...rows, ...(extra[`${roleId}:${objectTypeId}`] ?? [])];
  };
  return patched;
}

function extraRow(
  roleId: number,
  objectTypeId: number,
  lifeCycleId: number,
  ordinal: number,
  permission: number,
): ApiRolePermissionRow {
  const objectLifeCycleStateId = lifeCycleId * 100 + ordinal;
  return {
    id: 99_000_000 + objectLifeCycleStateId,
    permission,
    canBulkLaunch: false,
    canCreate: false,
    canDelete: false,
    canMerge: false,
    canManageRole: false,
    roleId,
    objectTypeId,
    objectLifeCycleId: lifeCycleId,
    objectLifeCycleStateId,
    formId: null,
    org: 1000,
    externalRefId: `probe-${roleId}-${objectLifeCycleStateId}`,
    assigned: false,
  };
}

{
  // Risk Champion holds 603272 on Incident but NOT 603174. Reporting read-write
  // on a 603174 state is the grant understating access. Separately, a level of
  // 7 on a granted state is a value the encoding does not cover.
  const anomalous = sourceWithExtraRows({
    '449680:450001': [extraRow(449680, 450001, 603174, 0, 2)],
    '449698:450001': [extraRow(449698, 450001, 603174, 9, 7)],
  });
  const anomalousRepo = new MatrixRepository(anomalous, 60_000, 6);
  const anomalousExport = await exportGroupWorkbook(anomalousRepo, GROUP_ID, {
    maxConcurrency: 6,
  });
  const anomalousSheet = await roundTrip(
    anomalousExport.workbook,
    `${OUT_DIR}/anomalous.xlsx`,
    MATRIX_SHEET,
  );
  const anomalousRecords = recordsOf(anomalousSheet);

  const understating = anomalousRecords.filter((record) => record['Grant Understates'] === true);
  check('exactly one row understates', understating.length === 1, understating.length);
  check(
    'it is Risk Champion on a lifecycle it was never granted',
    understating[0]?.['Role'] === 'Risk Champion' &&
      understating[0]['Lifecycle'] === 'Incident Workflow' &&
      understating[0]['Grant Covers State'] === false &&
      understating[0]['Reported Access'] === 'Read & write',
    understating[0],
  );
  check(
    'the two directions are mutually exclusive on that row',
    understating[0]?.['Grant Overstates'] === false,
    understating[0]?.['Grant Overstates'],
  );
  check(
    'the roll-up agrees with the per-state column',
    countWhere(anomalousRecords, 'Understated States', 1) === 8,
    countWhere(anomalousRecords, 'Understated States', 1),
  );

  // Ordinal 9 of 603174 does not exist in the catalog, so the row cannot be
  // attached to any state -- reported access this sheet cannot place.
  const incidentOwnerIncident = anomalousRecords.filter(
    (record) => record['Role'] === 'Incident Owner' && record['Object Type'] === 'Incident',
  );
  check(
    'a reported row that matches no state is counted, not dropped silently',
    incidentOwnerIncident.length === 8 &&
      incidentOwnerIncident.every((record) => record['Unmatched Reported Rows'] === 1),
    incidentOwnerIncident.map((record) => record['Unmatched Reported Rows']),
  );
  check(
    'and its lifecycle is named so the gap can be chased',
    incidentOwnerIncident.every((record) => record['Unmatched Lifecycle Ids'] === '603174'),
    incidentOwnerIncident[0]?.['Unmatched Lifecycle Ids'],
  );
}

{
  // A level the 0/1/2 encoding does not cover, on a state that does exist.
  const unknownLevel = sourceWithExtraRows({
    '449680:522608': [extraRow(449680, 522608, 710789, 0, 7)],
  });
  const unknownRepo = new MatrixRepository(unknownLevel, 60_000, 6);
  const unknownExport = await exportGroupWorkbook(unknownRepo, GROUP_ID, { maxConcurrency: 6 });
  const unknownSheet = await roundTrip(
    unknownExport.workbook,
    `${OUT_DIR}/unknown-level.xlsx`,
    MATRIX_SHEET,
  );
  const unknownRecords = recordsOf(unknownSheet);

  const odd = unknownRecords.find(
    (record) => record['Role'] === 'Risk Champion' && record['Object Type'] === 'Cyber Control' &&
      record['Reported Level'] === 7,
  );
  check(
    'an unreadable level is its own outcome, and carries the raw integer',
    odd?.['Reported Access'] === 'Unknown level (raw 7)' && odd['Reported Level'] === 7,
    { access: odd?.['Reported Access'], level: odd?.['Reported Level'] },
  );
  check(
    'it is neither "no access" nor "not reported"',
    odd?.['Reported Access'] !== 'No access' && odd?.['Reported Access'] !== 'Not reported',
  );
  check(
    'it does not count as an overstated grant',
    odd?.['Grant Overstates'] === false,
    odd?.['Grant Overstates'],
  );
  check(
    'and the roll-up counts it apart from unreported',
    unknownRecords
      .filter((record) => record['Object Type'] === 'Cyber Control')
      .every((record) => record['Unknown Level States'] === 1),
    unknownRecords
      .filter((record) => record['Object Type'] === 'Cyber Control')
      .map((record) => record['Unknown Level States']),
  );
}

/* -------------------------------------------------------------------------- */
/* 6c. A failed requirements call is not "nothing is required"                */
/* -------------------------------------------------------------------------- */

console.log('\nexport: a failed requirements call says so');

{
  const noRequirements = new MockResolverSource();
  noRequirements.fetchStateRequirements = async (): Promise<never> => {
    throw new ResolverApiError(
      'Upstream 503 for /object/objectType/stateRequired',
      503,
      '/object/objectType/stateRequired',
    );
  };
  const repo = new MatrixRepository(noRequirements, 60_000, 6);
  const degraded = await exportGroupWorkbook(repo, GROUP_ID, { maxConcurrency: 6 });
  const degradedSheet = await roundTrip(
    degraded.workbook,
    `${OUT_DIR}/no-requirements.xlsx`,
    MATRIX_SHEET,
  );
  const degradedRecords = recordsOf(degradedSheet);

  check(
    'every state row says unknown rather than 0 or blank',
    stateRows(degradedRecords).length === 31 &&
      stateRows(degradedRecords).every(
        (record) =>
          record['Requires Fields'] === 'unknown' &&
          record['Requires Roles'] === 'unknown' &&
          record['Requires Other'] === 'unknown',
      ),
    stateRows(degradedRecords)[0],
  );
  check(
    'the failure is named in its own column',
    stateRows(degradedRecords).every((record) =>
      String(record['Requirements Error']).includes('503'),
    ),
  );
  check(
    'and the reported permissions are unaffected',
    countWhere(degradedRecords, 'Reported Access', 'No access') === 1 &&
      countWhere(degradedRecords, 'Grant Overstates', true) === 1,
  );
}

/* -------------------------------------------------------------------------- */
/* 7. The extension point: one descriptor, one column                         */
/* -------------------------------------------------------------------------- */

console.log('\nexport: adding a column is one descriptor');

{
  const extra: ExportColumn = {
    header: 'Object Type Id',
    key: 'objectTypeIdProbe',
    width: 14,
    value: (row) => row.objectType?.objectTypeId ?? null,
  };
  const widened = await exportGroupWorkbook(repository, GROUP_ID, {
    maxConcurrency: 6,
    columns: [...MATRIX_COLUMNS, extra],
  });
  const widenedSheet = await roundTrip(widened.workbook, `${OUT_DIR}/widened.xlsx`, MATRIX_SHEET);
  const widenedHeaders = headersOf(widenedSheet);
  const widenedRecords = recordsOf(widenedSheet);

  check(
    'the sheet gains exactly one column, at the end',
    widenedHeaders.length === MATRIX_COLUMNS.length + 1 &&
      widenedHeaders[widenedHeaders.length - 1] === 'Object Type Id',
    widenedHeaders.slice(-2),
  );
  check(
    // Incident is reached by all three roles, 8 state rows each.
    'the new column is populated from the domain object',
    widenedRecords.filter((record) => record['Object Type Id'] === 450001).length === 24,
    widenedRecords.filter((record) => record['Object Type Id'] === 450001).length,
  );
  check(
    'and the existing columns are untouched',
    widenedRecords.length === 33 &&
      countWhere(widenedRecords, 'Grant Overstates', true) === 1,
  );
}

/* -------------------------------------------------------------------------- */
/* 8. Call budget                                                             */
/* -------------------------------------------------------------------------- */

console.log('\nexport: the measured call budget');

// 3 collection + 2 catalog + 1 per distinct role (3) + 1 per distinct
// (role, object type) pair (5) + 1 per distinct object type (3) = 16.
check(
  'a cold one-group export costs 19 upstream calls',
  source.total() === 19,
  source.counts,
);
check(
  'the per-pair and per-object-type terms are what they should be',
  source.counts['statePermissions'] === 5 && source.counts['stateRequirements'] === 3,
  source.counts,
);

{
  const before = source.total();
  await exportGroupWorkbook(repository, GROUP_ID, { maxConcurrency: 6 });
  check(
    'a warm re-export costs nothing',
    source.total() === before,
    { before, after: source.total() },
  );
}

/* -------------------------------------------------------------------------- */
/* 9. Sheet-name sanitizing                                                   */
/* -------------------------------------------------------------------------- */

console.log('\nexport: sheet names stay legal');

check(
  'forbidden characters are replaced',
  sanitizeSheetName('Risk / Compliance [2026]') === 'Risk Compliance 2026',
  sanitizeSheetName('Risk / Compliance [2026]'),
);
check(
  'over-long names are truncated to 31 characters',
  sanitizeSheetName('A'.repeat(60)).length === 31,
  sanitizeSheetName('A'.repeat(60)).length,
);
check('an empty name falls back', sanitizeSheetName('  ') === 'Permission Matrix');

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
