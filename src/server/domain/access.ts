import type {
  AccessCoverage,
  DerivationNote,
  LifeCycleAccess,
  LifeCycleId,
  ObjectTypeAccess,
  ObjectTypeAccessDetail,
  ObjectTypeId,
  Role,
  RoleAccess,
  StateAccess,
} from '../../shared/types/domain.ts';
import type { CatalogIndex } from './catalogIndex.ts';

/**
 * How role permissions are reconstructed.
 *
 * Resolver exposes no per-state permission endpoint. What it does expose is
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
  'The API exposes no per-state permission endpoint, so state-level access is inferred from the lifecycle grant.',
  'Access verbs (read / edit / delete) are not exposed by these endpoints and are therefore not shown.',
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
      'Access is granted per object lifecycle, not per state. Every state of a granted lifecycle is shown as reachable; states of a non-granted lifecycle on the same object type are not.',
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
export function buildObjectTypeAccessDetail(
  index: CatalogIndex,
  grantedLifeCycleIds: readonly LifeCycleId[],
  objectTypeId: ObjectTypeId,
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

    const states: StateAccess[] = lifeCycle.states.map((state) => ({ ...state, granted }));
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
  };
}
