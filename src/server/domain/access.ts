import type {
  AccessCoverage,
  DerivationNote,
  LifeCycleAccess,
  LifeCycleId,
  LifeCycleStateId,
  PermissionSummary,
  StatePermission,
  StateRequirements,
  StateTrigger,
  ObjectTypeAccess,
  ObjectTypeAccessDetail,
  ObjectTypeId,
  Role,
  RoleAccess,
  StateAccess,
} from '../../shared/types/domain.ts';
import type { CatalogIndex } from './catalogIndex.ts';

/**
 * How the object-type list for a role is reconstructed.
 *
 * NOTE: this concerns the *summary* only. Per-state access is no longer
 * inferred -- `/data/rolePermissions/role/{roleId}/objectType/{objectTypeId}`
 * reports it directly and is merged in by `buildObjectTypeAccessDetail`.
 * Measured against the live API, a role holding a lifecycle grant had level 0
 * (no access) in 19 of that lifecycle's 25 states, so the inference below is
 * an upper bound and is labelled as such in the UI.
 *
 * For the summary, what the API exposes is
 * `/data/rolePermissions/objectLifeCycles/role/{roleId}` -- the set of object
 * lifecycles a role has been granted. Each lifecycle carries an `objectTypeId`
 * and (with includeStates=true) its states, so:
 *
 *   role -> granted lifecycle ids            (per-role call)
 *   lifecycle -> objectTypeId, states        (one catalog call)
 *   objectType -> all of its lifecycles      (one catalog call)
 *
 * gives "which object types can this role touch, and in which states". A grant
 * is lifecycle-wide, so every state of a granted lifecycle is reachable; states
 * belonging to a non-granted lifecycle of the same object type are not. That is
 * the inference, and it is reported to the client in `DerivationNote`.
 */
const BASE_CAVEATS: readonly string[] = [
  'This summary is derived from lifecycle grants, which are expected to be an upper bound: open an object type to see the access levels the API actually reports per state, which are frequently narrower. Where the reported access instead exceeds the grant, the drill-down flags it rather than assuming the grant wins.',
  'An object type can own several lifecycles; partial coverage means only some of them are granted.',
  'Object type <-> lifecycle association is itself merged from two upstream pointers (objectType.objectLifeCycleId and objectLifeCycle.objectTypeId), which do not always agree. Coverage is measured against that merged set.',
];

const NO_STATES_CAVEAT =
  'This catalog returned no lifecycle states, so state-level detail is unavailable and every granted lifecycle shows 0 states. Check that the upstream honoured includeStates=true.';

/**
 * Describes how the access shown was derived. Travels with every GroupMatrix
 * so the UI can state the inference instead of implying the API reported it.
 */
export function buildDerivationNote(statesAvailable: boolean): DerivationNote {
  return {
    method: 'lifecycle-grant-implies-all-states',
    summary:
      'Roles are granted whole lifecycles, so this list shows the object types a role can reach at all. It is an upper bound: the per-state access levels inside each object type are reported by the API and are often narrower than the grant suggests.',
    caveats: statesAvailable ? [...BASE_CAVEATS] : [NO_STATES_CAVEAT, ...BASE_CAVEATS],
    statesAvailable,
  };
}

function coverageOf(grantedCount: number, totalCount: number): AccessCoverage {
  if (grantedCount === 0) return 'none';
  return grantedCount >= totalCount ? 'full' : 'partial';
}

/**
 * Rolls a role's granted lifecycle ids up into per-object-type access.
 *
 * Complexity is O(G + sum of lifecycles on the touched object types), where G
 * is the number of grants -- linear in the data the role actually reaches, not
 * in the size of the catalog.
 *
 * `grantsError` is set when the role's grants could not be fetched; the role
 * then renders with no access and an explicit error rather than looking empty.
 */
export function buildRoleAccess(
  index: CatalogIndex,
  role: Role,
  grantedLifeCycleIds: readonly LifeCycleId[],
  grantsError: string | null = null,
): RoleAccess {
  const grantedSet = new Set(grantedLifeCycleIds);
  const grantedByObjectType = new Map<ObjectTypeId, LifeCycleId[]>();
  const unresolvedLifeCycleIds: LifeCycleId[] = [];

  for (const lifeCycleId of grantedSet) {
    // Attribution goes through the same merged bindings that coverage totals
    // use, so a grant can never be counted against a denominator it is not
    // part of. A lifecycle owned by two object types grants access to both.
    const owners = index.objectTypeIdsByLifeCycle.get(lifeCycleId);
    if (owners === undefined || owners.length === 0) {
      unresolvedLifeCycleIds.push(lifeCycleId);
      continue;
    }
    for (const objectTypeId of owners) {
      const bucket = grantedByObjectType.get(objectTypeId);
      if (bucket === undefined) {
        grantedByObjectType.set(objectTypeId, [lifeCycleId]);
      } else {
        bucket.push(lifeCycleId);
      }
    }
  }

  const objectTypes: ObjectTypeAccess[] = [];
  for (const [objectTypeId, grantedIds] of grantedByObjectType) {
    const objectType = index.objectTypeById.get(objectTypeId);
    if (objectType === undefined) continue;

    let grantedStateCount = 0;
    for (const lifeCycleId of grantedIds) {
      grantedStateCount += index.lifeCycleById.get(lifeCycleId)?.states.length ?? 0;
    }

    objectTypes.push({
      objectTypeId,
      name: objectType.name,
      pluralName: objectType.pluralName,
      monogram: objectType.monogram,
      color: objectType.color,
      coverage: coverageOf(grantedIds.length, objectType.lifeCycleIds.length),
      grantedLifeCycleCount: grantedIds.length,
      totalLifeCycleCount: objectType.lifeCycleIds.length,
      grantedStateCount,
      totalStateCount: index.totalStatesByObjectType.get(objectTypeId) ?? 0,
    });
  }

  objectTypes.sort((a, b) => a.name.localeCompare(b.name));
  unresolvedLifeCycleIds.sort((a, b) => a - b);

  return { role, objectTypes, unresolvedLifeCycleIds, grantsError };
}

/**
 * Expands one object type for one role: every lifecycle it owns, every state
 * of those lifecycles, each flagged granted or not.
 *
 * O(lifecycles on the object type + their states).
 */
/**
 * Per-state facts reported by the API, as opposed to inferred from the grant.
 *
 * `byStateId` empty with `error === null` means the endpoint answered but had
 * nothing for this pair, which is different from it being unreachable.
 */
export interface ReportedPermissions {
  byStateId: ReadonlyMap<LifeCycleStateId, StatePermission>;
  requirementsByStateId: ReadonlyMap<LifeCycleStateId, StateRequirements>;
  /** Every trigger on each state, from the workflow definition. */
  triggersByStateId: ReadonlyMap<LifeCycleStateId, StateTrigger[]>;
  /** Rows the endpoint returned, so dropped rows can be detected. */
  rowCount: number;
  /** The lifecycle each returned row claimed. */
  lifeCycleIdByStateId: ReadonlyMap<LifeCycleStateId, number>;
  duplicateCount: number;
  error: string | null;
  requirementsError: string | null;
  triggersError: string | null;
}

const NO_REPORTED_PERMISSIONS: ReportedPermissions = {
  byStateId: new Map(),
  requirementsByStateId: new Map(),
  triggersByStateId: new Map(),
  rowCount: 0,
  lifeCycleIdByStateId: new Map(),
  duplicateCount: 0,
  error: null,
  requirementsError: null,
  triggersError: null,
};

export function buildObjectTypeAccessDetail(
  index: CatalogIndex,
  grantedLifeCycleIds: readonly LifeCycleId[],
  objectTypeId: ObjectTypeId,
  reported: ReportedPermissions = NO_REPORTED_PERMISSIONS,
): ObjectTypeAccessDetail | null {
  const objectType = index.objectTypeById.get(objectTypeId);
  if (objectType === undefined) return null;

  const grantedSet = new Set(grantedLifeCycleIds);
  const lifeCycles: LifeCycleAccess[] = [];
  let grantedLifeCycleCount = 0;
  let grantedStateCount = 0;
  let totalStateCount = 0;

  for (const lifeCycleId of objectType.lifeCycleIds) {
    const lifeCycle = index.lifeCycleById.get(lifeCycleId);
    if (lifeCycle === undefined) continue;

    const granted = grantedSet.has(lifeCycleId);
    if (granted) grantedLifeCycleCount += 1;
    totalStateCount += lifeCycle.states.length;
    if (granted) grantedStateCount += lifeCycle.states.length;

    const states: StateAccess[] = lifeCycle.states.map((state) => {
      const permission = reported.byStateId.get(state.id) ?? null;
      return {
        ...state,
        granted,
        // The reported permission wins where it exists; `granted` stays as the
        // cheap inference so the two can be compared in the UI.
        permission,
        requirements: reported.requirementsByStateId.get(state.id) ?? null,
        triggers: mergeStateTriggers(reported.triggersByStateId.get(state.id), permission),
      };
    });
    lifeCycles.push({
      lifeCycleId,
      name: lifeCycle.name,
      description: lifeCycle.description,
      granted,
      states,
    });
  }

  // Granted lifecycles first, then alphabetical, so the relevant rows lead.
  lifeCycles.sort((a, b) =>
    a.granted === b.granted ? a.name.localeCompare(b.name) : Number(b.granted) - Number(a.granted),
  );

  const permissionSummary = summarizePermissions(lifeCycles, reported);

  return {
    objectTypeId,
    name: objectType.name,
    pluralName: objectType.pluralName,
    description: objectType.description,
    monogram: objectType.monogram,
    color: objectType.color,
    coverage: coverageOf(grantedLifeCycleCount, objectType.lifeCycleIds.length),
    grantedLifeCycleCount,
    totalLifeCycleCount: objectType.lifeCycleIds.length,
    grantedStateCount,
    totalStateCount,
    lifeCycles,
    permissionSummary,
    permissionsError: reported.error,
    requirementsError: reported.requirementsError,
    triggersError: reported.triggersError,
  };
}

/**
 * Marks the triggers this role may fire within the state's full set.
 *
 * When the workflow definition is unavailable, the role's own ids are still
 * known, so they are listed with placeholder names rather than dropped -- the
 * caller reports `triggersError` so the UI can say the list is incomplete.
 */
function mergeStateTriggers(
  available: readonly StateTrigger[] | undefined,
  permission: StatePermission | null,
): StateTrigger[] {
  const grantedIds = new Set(permission?.triggerIds ?? []);

  if (available === undefined) {
    return [...grantedIds]
      .sort((a, b) => a - b)
      .map((id) => ({
        id,
        name: `Trigger ${id}`,
        granted: true,
        destinations: [],
        isWorkflow: true,
      }));
  }

  const merged = available.map((trigger) => ({
    ...trigger,
    granted: grantedIds.has(trigger.id),
  }));

  // A granted id the workflow definition does not list still belongs on the
  // state: the role demonstrably holds it.
  const listed = new Set(available.map((trigger) => trigger.id));
  for (const id of grantedIds) {
    if (!listed.has(id)) {
      merged.push({
        id,
        name: `Trigger ${id}`,
        granted: true,
        destinations: [],
        isWorkflow: true,
      });
    }
  }

  // Granted first, then alphabetical, so the role's own actions lead.
  merged.sort((a, b) =>
    a.granted === b.granted ? a.name.localeCompare(b.name) : Number(b.granted) - Number(a.granted),
  );
  return merged;
}

/**
 * Counts states by reported level, and reconciles what was reported against
 * what could be attached.
 *
 * A row whose state id is not in the merged catalog cannot be shown against
 * any state, so it is counted as unmatched rather than quietly dropped -- the
 * catalog's two object-type pointers are known to disagree, which is exactly
 * when this happens. O(states + rows).
 */
function summarizePermissions(
  lifeCycles: readonly LifeCycleAccess[],
  reported: ReportedPermissions,
): PermissionSummary {
  const summary: PermissionSummary = {
    readWrite: 0,
    read: 0,
    none: 0,
    unknown: 0,
    unreported: 0,
    // Driven by what the endpoint returned, not by what could be matched: a
    // non-empty response must never render as "nothing was reported".
    reported: reported.rowCount > 0,
    unmatchedReportedRows: 0,
    unmatchedLifeCycleIds: [],
    duplicateReportedRows: reported.duplicateCount,
    overstatedStates: 0,
    understatedStates: 0,
  };

  const matchedStateIds = new Set<LifeCycleStateId>();

  for (const lifeCycle of lifeCycles) {
    for (const state of lifeCycle.states) {
      if (state.permission === null) {
        summary.unreported += 1;
        continue;
      }
      matchedStateIds.add(state.id);

      switch (state.permission.level) {
        case 'read-write':
          summary.readWrite += 1;
          break;
        case 'read':
          summary.read += 1;
          break;
        case 'none':
          summary.none += 1;
          break;
        default:
          summary.unknown += 1;
      }

      // The grant and the report disagreeing is worth counting in both
      // directions; the app assumes the grant is an upper bound, and this is
      // what would falsify that.
      if (state.granted && state.permission.level === 'none') summary.overstatedStates += 1;
      if (!state.granted && state.permission.level !== 'none') summary.understatedStates += 1;
    }
  }

  const unmatchedLifeCycleIds = new Set<LifeCycleId>();
  for (const [stateId, lifeCycleId] of reported.lifeCycleIdByStateId) {
    if (!matchedStateIds.has(stateId)) unmatchedLifeCycleIds.add(lifeCycleId);
  }
  // rowCount counts rows; matched counts states. Duplicates were folded into a
  // state, so they are not unmatched.
  summary.unmatchedReportedRows = Math.max(
    0,
    reported.rowCount - reported.duplicateCount - matchedStateIds.size,
  );
  summary.unmatchedLifeCycleIds = [...unmatchedLifeCycleIds].sort((a, b) => a - b);

  return summary;
}
