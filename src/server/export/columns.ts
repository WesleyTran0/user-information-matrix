/**
 * THE EXTENSION POINT.
 *
 * Every column of the exported sheet is declared here and nowhere else. The
 * workbook writer iterates this array for the header row and for each cell, so
 * a new field on the domain model becomes a new column by appending one
 * descriptor below -- no writer, row builder or check needs editing.
 *
 * The column set is deliberately not frozen. The identity columns
 * (Group / Role / Object Type / Lifecycle / State) keep their relative order
 * because that is the order the pivot's row axis is expected to be built in;
 * everything after them is a projection that fell out of the domain model.
 *
 * Conventions for new descriptors:
 *   - `value` must be total: return `null` rather than throwing on a partial
 *     row (see `MatrixExportRow` -- the trailing members are nullable).
 *   - keep `value` pure and cheap; it runs once per cell.
 *   - ids and counts are written as numbers so Excel groups and sorts them
 *     numerically rather than as text.
 *
 * Obvious columns not built yet, each a one-liner here when wanted:
 *   - `Form Id` from `state.permission.formId`.
 *   - user columns (`GroupMatrix.users`), which would require the row tuple to
 *     gain a `user` member and multiply row counts by group membership.
 */
import type { ExportColumn, MatrixExportRow } from './types.ts';

/**
 * Trigger names for one side of the granted/not-granted split.
 *
 * Null rather than an empty string when the state itself is absent, so an
 * incomplete tuple leaves a genuinely empty cell instead of looking like a
 * state that happens to have no triggers.
 */
function joinTriggerNames(row: MatrixExportRow, granted: boolean): string | null {
  if (row.state === null) return null;
  const names = row.state.triggers
    .filter((trigger) => trigger.granted === granted)
    .map((trigger) => trigger.name);
  return names.length === 0 ? '' : names.join(', ');
}

/**
 * The four negative-ish outcomes below must never collapse into one cell value.
 * They mean different things and an auditor acting on the sheet needs to tell
 * them apart:
 *
 *   'No access'                -- the API reported a row, and it says level 0.
 *   'Not reported'             -- the call succeeded but returned no row for
 *                                 this state. Resolver simply has nothing here.
 *   'Permissions unavailable'  -- the call failed. We do not know anything.
 *   'Unknown level (raw N)'    -- the API reported a level outside the known
 *                                 0/1/2 encoding. Neither "no access" nor
 *                                 "not reported": it is a fact we cannot read.
 *
 * Writing an empty cell for all four would read as "no access everywhere",
 * which is the single most dangerous mistake this export could make.
 */
function reportedAccess(row: MatrixExportRow): string | null {
  if (row.state === null) return null;

  const permission = row.state.permission;
  if (permission === null) {
    if (row.objectType?.permissionsError != null) return 'unavailable';
    return 'unreported';
  }

  switch (permission.level) {
    case 'read-write':
      return 'edit';
    case 'read':
      return 'read';
    case 'none':
      return 'none';
    default:
      return 'unknown';
  }
}

/**
 * The access level as two booleans.
 *
 * `null`, not `false`, when nothing was reported -- a filter on FALSE must not
 * silently pick up states nobody checked. This is why the one-word `Access`
 * column stays even though read/edit are booleans: only it distinguishes
 * `none` from `unreported`, `unavailable` and `unknown`.
 */
function canAccess(row: MatrixExportRow, level: 'read' | 'edit'): boolean | null {
  const permission = row.state?.permission;
  if (permission == null) return null;
  if (permission.level === 'unknown') return null;
  if (level === 'read') return permission.level === 'read' || permission.level === 'read-write';
  return permission.level === 'read-write';
}

/** A capability flag, null when no permission row was reported. */
function capability(
  row: MatrixExportRow,
  key: 'canCreate' | 'canDelete' | 'canMerge' | 'canManageRole' | 'canBulkLaunch',
): boolean | null {
  const permission = row.state?.permission;
  if (permission == null) return null;
  return permission.capabilities[key];
}

export const MATRIX_COLUMNS: readonly ExportColumn[] = [
  /* identity --------------------------------------------------------------- */
  { header: 'Group', key: 'group', width: 34, value: (row) => row.group.name },
  // Names are not unique: 28 of this tenant's 207 groups share a name with
  // another group, so filtering this sheet by name alone silently merges two
  // different groups. The id sits next to the name it disambiguates.
  { header: 'Group Id', key: 'groupId', width: 11, value: (row) => row.group.id },
  { header: 'Role', key: 'role', width: 30, value: (row) => row.role.name },
  { header: 'Role Id', key: 'roleId', width: 10, value: (row) => row.role.id },
  {
    header: 'Object Type',
    key: 'objectType',
    width: 30,
    value: (row) => row.objectType?.name ?? null,
  },
  {
    header: 'Lifecycle',
    key: 'lifeCycle',
    width: 28,
    value: (row) => row.lifeCycle?.name ?? null,
  },
  { header: 'State', key: 'state', width: 26, value: (row) => row.state?.name ?? null },

  /* access ----------------------------------------------------------------- */
  // One word, and the only column that separates 'none' from 'unreported',
  // 'unavailable' and 'unknown'. The booleans below cannot express that.
  { header: 'Access', key: 'access', width: 12, value: reportedAccess },
  { header: 'Can Read', key: 'canRead', width: 10, value: (row) => canAccess(row, 'read') },
  { header: 'Can Edit', key: 'canEdit', width: 10, value: (row) => canAccess(row, 'edit') },
  { header: 'Can Create', key: 'canCreate', width: 11, value: (row) => capability(row, 'canCreate') },
  { header: 'Can Delete', key: 'canDelete', width: 11, value: (row) => capability(row, 'canDelete') },
  { header: 'Can Merge', key: 'canMerge', width: 11, value: (row) => capability(row, 'canMerge') },
  {
    // The API field is `canManageRole`, but it grants managing this object
    // type while it is in this state -- your correction on the web UI.
    header: 'Can Manage',
    key: 'canManage',
    width: 12,
    value: (row) => capability(row, 'canManageRole'),
  },
  {
    header: 'Can Bulk Launch',
    key: 'canBulkLaunch',
    width: 15,
    value: (row) => capability(row, 'canBulkLaunch'),
  },

  /* triggers --------------------------------------------------------------- */
  {
    header: '# Triggers Granted',
    key: 'triggerCount',
    width: 17,
    value: (row) =>
      row.state === null ? null : row.state.triggers.filter((trigger) => trigger.granted).length,
  },
  {
    header: '# Triggers Available',
    key: 'triggerAvailableCount',
    width: 19,
    value: (row) => (row.state === null ? null : row.state.triggers.length),
  },
  {
    header: 'Triggers Granted',
    key: 'triggerNames',
    width: 52,
    // Joined into one cell: one row per trigger would multiply the sheet by a
    // factor nobody asked to pivot on.
    value: (row) => joinTriggerNames(row, true),
  },
];
