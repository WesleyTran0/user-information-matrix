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
import type { StateRequirements } from '../../shared/types/domain.ts';
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
      // Carry the raw value inline as well as in `Reported Level`, so the cell
      // is self-explanatory when the sheet is filtered down to one column.
      return `Unknown level (raw ${permission.rawLevel})`;
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

/**
 * The mirror of `grantOverstates`: the lifecycle grant does not cover the state
 * yet the API reports access in it. The app treats the grant as an upper bound
 * on access, so a TRUE here is that assumption being violated.
 *
 * The predicate deliberately matches `PermissionSummary.understatedStates`
 * exactly -- including treating an unrecognised level as access rather than as
 * nothing -- so a per-state filter and the object-type roll-up always agree.
 */
function grantUnderstates(row: MatrixExportRow): boolean | null {
  const permission = row.state?.permission;
  if (permission == null) return null;
  return !row.grantCoversState && permission.level !== 'none';
}

/**
 * Exit requirements, with a failed call kept distinct from "nothing required".
 *
 * A number always means the endpoint answered: 0 is a reported zero, not a
 * blank. `'unknown'` means the call failed, which without this would be
 * indistinguishable from a state that genuinely requires nothing.
 */
function requirementCell(
  row: MatrixExportRow,
  pick: (requirements: StateRequirements) => number,
): string | number | null {
  if (row.state === null || row.objectType === null) return null;
  if (row.objectType.requirementsError !== null) return 'unknown';
  const requirements = row.state.requirements;
  return requirements === null ? 0 : pick(requirements);
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
    header: 'Triggers Granted',
    key: 'triggerCount',
    width: 15,
    // Counted off the merged trigger list rather than the permission row, so
    // it agrees with the names in the next column.
    value: (row) =>
      row.state === null ? null : row.state.triggers.filter((trigger) => trigger.granted).length,
  },
  {
    header: 'Triggers Available',
    key: 'triggerAvailableCount',
    width: 17,
    // The denominator: every trigger on the state, granted or not. "2 of 24"
    // is the fact an auditor is actually after.
    value: (row) => (row.state === null ? null : row.state.triggers.length),
  },
  {
    header: 'Trigger Names (granted)',
    key: 'triggerNames',
    width: 40,
    // Joined into one cell: one row per trigger would multiply the sheet by a
    // factor nobody asked to pivot on.
    value: (row) => joinTriggerNames(row, true),
  },
  {
    header: 'Trigger Names (not granted)',
    key: 'triggerNamesOther',
    width: 40,
    value: (row) => joinTriggerNames(row, false),
  },
  {
    header: 'Trigger Ids (granted)',
    key: 'triggerIds',
    width: 24,
    // Kept alongside the names: ids are what the API rows reference, so they
    // are the join key if anyone cross-references this sheet with a raw dump.
    // Emitted in the same order as the names column, so the Nth id is the Nth
    // name rather than requiring a second lookup.
    value: (row) => {
      if (row.state === null) return null;
      const ids = row.state.triggers.filter((trigger) => trigger.granted).map((t) => t.id);
      return ids.length === 0 ? '' : ids.join(', ');
    },
  },

  /* grant vs. reported ------------------------------------------------------ */
  {
    header: 'Grant Covers State',
    key: 'grantCoversState',
    width: 18,
    value: (row) => row.grantCoversState,
  },
  { header: 'Grant Overstates', key: 'grantOverstates', width: 17, value: grantOverstates },
  { header: 'Grant Understates', key: 'grantUnderstates', width: 18, value: grantUnderstates },

  /* state requirements ------------------------------------------------------ */
  {
    header: 'Requires Fields',
    key: 'requiresFields',
    width: 15,
    value: (row) => requirementCell(row, (requirements) => requirements.fieldCount),
  },
  {
    header: 'Requires Roles',
    key: 'requiresRoles',
    width: 14,
    value: (row) => requirementCell(row, (requirements) => requirements.roleCount),
  },
  {
    header: 'Requires Other',
    key: 'requiresOther',
    width: 14,
    value: (row) => requirementCell(row, (requirements) => requirements.otherCount),
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

  /* per-object-type data-quality roll-ups ----------------------------------- */
  // These repeat down every row of a (role, object type) block, exactly like
  // the coverage counts above. That is what lets a pivot at object-type
  // granularity find the problem blocks without scanning states.
  {
    header: 'Overstated States',
    key: 'overstatedStates',
    width: 17,
    value: (row) => row.objectType?.permissionSummary.overstatedStates ?? null,
  },
  {
    header: 'Understated States',
    key: 'understatedStates',
    width: 18,
    value: (row) => row.objectType?.permissionSummary.understatedStates ?? null,
  },
  {
    header: 'Unknown Level States',
    key: 'unknownLevelStates',
    width: 20,
    value: (row) => row.objectType?.permissionSummary.unknown ?? null,
  },
  {
    // Non-zero means the endpoint reported access this sheet could not place
    // against any state, so the rows below understate the truth. It has to be
    // visible or the export quietly loses reported access.
    header: 'Unmatched Reported Rows',
    key: 'unmatchedReportedRows',
    width: 23,
    value: (row) => row.objectType?.permissionSummary.unmatchedReportedRows ?? null,
  },
  {
    header: 'Unmatched Lifecycle Ids',
    key: 'unmatchedLifeCycleIds',
    width: 24,
    value: (row) => {
      const ids = row.objectType?.permissionSummary.unmatchedLifeCycleIds;
      if (ids === undefined) return null;
      return ids.length === 0 ? '' : ids.join(', ');
    },
  },
  {
    header: 'Duplicate Reported Rows',
    key: 'duplicateReportedRows',
    width: 23,
    value: (row) => row.objectType?.permissionSummary.duplicateReportedRows ?? null,
  },

  /* provenance -------------------------------------------------------------- */
  {
    header: 'Permissions Error',
    key: 'permissionsError',
    width: 40,
    value: (row) => row.objectType?.permissionsError ?? null,
  },
  {
    header: 'Requirements Error',
    key: 'requirementsError',
    width: 40,
    value: (row) => row.objectType?.requirementsError ?? null,
  },
  { header: 'Note', key: 'note', width: 52, value: (row) => row.note },
];
