import type {
  Catalog,
  LifeCycle,
  LifeCycleId,
  ObjectType,
  ObjectTypeId,
} from '../../shared/types/domain.ts';

/**
 * Lookup structures built once per catalog load so that access derivation
 * never scans the full object-type or lifecycle lists.
 */
export interface CatalogIndex {
  catalog: Catalog;
  objectTypeById: ReadonlyMap<ObjectTypeId, ObjectType>;
  lifeCycleById: ReadonlyMap<LifeCycleId, LifeCycle>;
  /**
   * Which object types a lifecycle belongs to.
   *
   * Inverted from `ObjectType.lifeCycleIds` -- deliberately the *same* merged
   * bindings that coverage totals are measured against, so a grant's numerator
   * and denominator can never come from different sources. A lifecycle can map
   * to more than one object type when two object types point at it.
   */
  objectTypeIdsByLifeCycle: ReadonlyMap<LifeCycleId, ObjectTypeId[]>;
  /** Total states across every lifecycle bound to an object type. */
  totalStatesByObjectType: ReadonlyMap<ObjectTypeId, number>;
  /**
   * False when the catalog came back with no lifecycle states at all, which
   * means the upstream payload did not carry them and state-level access
   * cannot be shown. Surfaced rather than silently rendering "0/0 states".
   */
  statesAvailable: boolean;
}

/** O(objectTypes + lifeCycles + bindings). */
export function buildCatalogIndex(catalog: Catalog): CatalogIndex {
  const objectTypeById = new Map<ObjectTypeId, ObjectType>();
  for (const objectType of catalog.objectTypes) {
    objectTypeById.set(objectType.id, objectType);
  }

  const lifeCycleById = new Map<LifeCycleId, LifeCycle>();
  for (const lifeCycle of catalog.lifeCycles) {
    lifeCycleById.set(lifeCycle.id, lifeCycle);
  }

  const objectTypeIdsByLifeCycle = new Map<LifeCycleId, ObjectTypeId[]>();
  const totalStatesByObjectType = new Map<ObjectTypeId, number>();

  // Iterate the de-duplicated map, not the raw array: a repeated object type id
  // upstream would otherwise append its id twice and credit a grant twice,
  // producing counts like "2/1 lifecycles".
  for (const objectType of objectTypeById.values()) {
    let total = 0;
    for (const lifeCycleId of objectType.lifeCycleIds) {
      total += lifeCycleById.get(lifeCycleId)?.states.length ?? 0;

      const owners = objectTypeIdsByLifeCycle.get(lifeCycleId);
      if (owners === undefined) {
        objectTypeIdsByLifeCycle.set(lifeCycleId, [objectType.id]);
      } else {
        owners.push(objectType.id);
      }
    }
    totalStatesByObjectType.set(objectType.id, total);
  }

  const statesAvailable =
    catalog.lifeCycles.length === 0 ||
    catalog.lifeCycles.some((lifeCycle) => lifeCycle.states.length > 0);

  return {
    catalog,
    objectTypeById,
    lifeCycleById,
    objectTypeIdsByLifeCycle,
    totalStatesByObjectType,
    statesAvailable,
  };
}
