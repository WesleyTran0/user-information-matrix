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
 *   - `Grant Understates` -- the mirror of `Grant Overstates`: the grant is
 *     absent yet the API reports read or write. No fixture exercises it today,
 *     so it is left out rather than shipped untested.
 *   - `Form Id` from `state.permission.formId`.
 *   - user columns (`GroupMatrix.users`), which would require the row tuple to
 *     gain a `user` member and multiply row counts by group membership.
 */
import type { ExportColumn, MatrixExportRow } from './types.ts';

/**
 * The three outcomes below must never collapse into one cell value. They mean
 * different things and an auditor acting on the sheet needs to tell them apart:
 *
 *   'No access'                -- the API reported a row, and it says level 0.
 *   'Not reported'             -- the call succeeded but returned no row for
 *                                 this state. Resolver simply has nothing here.
 *   'Permissions unavailable'  -- the call failed. We do not know anything.
 *
 * Writing an empty cell for all three would read as "no access everywhere",
 * which is the single most dangerous mistake this export could make.
 */
function reportedAccess(row: MatrixExportRow): string | null {
  if (row.state === null) return null;

  const permission = row.state.permission;
  if (permission === null) {
    if (row.objectType?.permissionsError != null) return 'Permissions unavailable';
    return 'Not reported';
  }

  switch (permission.level) {
    case 'read-write':
      return 'Read & write';
    case 'read':
      return 'Read only';
    case 'none':
      return 'No access';
    default:
      // An unrecognised level is not "no access"; show the raw value so an
      // upstream change is visible instead of being rounded down to zero.
      return `Unknown (raw ${permission.rawLevel})`;
  }
}

/**
 * TRUE where the role holds the lifecycle grant but the API reports no access
 * at all in the state -- i.e. the grant claims more than it delivers.
 *
 * `null`, not `false`, when nothing was reported: "we did not check" is not the
 * same claim as "the grant is accurate", and a filter on FALSE must not quietly
 * pick up unverified rows.
 */
function grantOverstates(row: MatrixExportRow): boolean | null {
  const permission = row.state?.permission;
  if (permission == null) return null;
  return row.grantCoversState && permission.level === 'none';
}

export const MATRIX_COLUMNS: readonly ExportColumn[] = [
  /* identity ---------------------------------------------------------------- */
  { header: 'Group', key: 'group', width: 34, value: (row) => row.group.name },
  { header: 'Group Id', key: 'groupId', width: 11, value: (row) => row.group.id },
  { header: 'Role', key: 'role', width: 30, value: (row) => row.role.name },
  { header: 'Role Id', key: 'roleId', width: 11, value: (row) => row.role.id },
  { header: 'Role Is Global', key: 'roleIsGlobal', width: 14, value: (row) => row.role.isGlobal },
  {
    header: 'Object Type',
    key: 'objectType',
    width: 34,
    value: (row) => row.objectType?.name ?? null,
  },
  {
    header: 'Object Type Monogram',
    key: 'objectTypeMonogram',
    width: 20,
    value: (row) => row.objectType?.monogram ?? null,
  },
  { header: 'Lifecycle', key: 'lifeCycle', width: 32, value: (row) => row.lifeCycle?.name ?? null },
  { header: 'State', key: 'state', width: 24, value: (row) => row.state?.name ?? null },
  {
    header: 'State Ordinal',
    key: 'stateOrdinal',
    width: 13,
    value: (row) => row.state?.ordinal ?? null,
  },

  /* reported access --------------------------------------------------------- */
  { header: 'Reported Access', key: 'reportedAccess', width: 22, value: reportedAccess },
  {
    header: 'Reported Level',
    key: 'reportedLevel',
    width: 14,
    value: (row) => row.state?.permission?.rawLevel ?? null,
  },
  {
    header: 'Can Create',
    key: 'canCreate',
    width: 11,
    value: (row) => row.state?.permission?.capabilities.canCreate ?? null,
  },
  {
    header: 'Can Delete',
    key: 'canDelete',
    width: 11,
    value: (row) => row.state?.permission?.capabilities.canDelete ?? null,
  },
  {
    header: 'Can Merge',
    key: 'canMerge',
    width: 11,
    value: (row) => row.state?.permission?.capabilities.canMerge ?? null,
  },
  {
    header: 'Can Manage Role',
    key: 'canManageRole',
    width: 16,
    value: (row) => row.state?.permission?.capabilities.canManageRole ?? null,
  },
  {
    header: 'Can Bulk Launch',
    key: 'canBulkLaunch',
    width: 16,
    value: (row) => row.state?.permission?.capabilities.canBulkLaunch ?? null,
  },
  {
    header: 'Trigger Count',
    key: 'triggerCount',
    width: 13,
    value: (row) => row.state?.permission?.triggerIds.length ?? null,
  },
  {
    header: 'Trigger Ids',
    key: 'triggerIds',
    width: 30,
    // Joined into one cell: trigger ids have no names upstream, and one row per
    // trigger would multiply the sheet by a factor nobody asked to pivot on.
    value: (row) => {
      const triggerIds = row.state?.permission?.triggerIds;
      if (triggerIds === undefined) return null;
      return triggerIds.length === 0 ? '' : triggerIds.join(', ');
    },
  },

  /* grant-vs-reported comparison -------------------------------------------- */
  {
    header: 'Grant Covers State',
    key: 'grantCoversState',
    width: 18,
    value: (row) => row.grantCoversState,
  },
  { header: 'Grant Overstates', key: 'grantOverstates', width: 17, value: grantOverstates },

  /* state requirements ------------------------------------------------------ */
  {
    header: 'Requires Fields',
    key: 'requiresFields',
    width: 15,
    value: (row) => row.state?.requirements?.fieldCount ?? null,
  },
  {
    header: 'Requires Roles',
    key: 'requiresRoles',
    width: 14,
    value: (row) => row.state?.requirements?.roleCount ?? null,
  },
  {
    header: 'Requires Other',
    key: 'requiresOther',
    width: 14,
    value: (row) => row.state?.requirements?.otherCount ?? null,
  },

  /* object-type roll-ups ---------------------------------------------------- */
  { header: 'Coverage', key: 'coverage', width: 11, value: (row) => row.objectType?.coverage ?? null },
  {
    header: 'Granted Lifecycles',
    key: 'grantedLifeCycles',
    width: 18,
    value: (row) => row.objectType?.grantedLifeCycleCount ?? null,
  },
  {
    header: 'Total Lifecycles',
    key: 'totalLifeCycles',
    width: 16,
    value: (row) => row.objectType?.totalLifeCycleCount ?? null,
  },
  {
    header: 'Granted States',
    key: 'grantedStates',
    width: 14,
    value: (row) => row.objectType?.grantedStateCount ?? null,
  },
  {
    header: 'Total States',
    key: 'totalStates',
    width: 13,
    value: (row) => row.objectType?.totalStateCount ?? null,
  },

  /* provenance -------------------------------------------------------------- */
  {
    header: 'Permissions Error',
    key: 'permissionsError',
    width: 40,
    value: (row) => row.objectType?.permissionsError ?? null,
  },
  { header: 'Note', key: 'note', width: 52, value: (row) => row.note },
];
