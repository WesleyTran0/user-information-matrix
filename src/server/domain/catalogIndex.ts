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
  /** Total states across every lifecycle bound to an object type. */
  totalStatesByObjectType: ReadonlyMap<ObjectTypeId, number>;
}

/** O(objectTypes + lifeCycles). */
export function buildCatalogIndex(catalog: Catalog): CatalogIndex {
  const objectTypeById = new Map<ObjectTypeId, ObjectType>();
  for (const objectType of catalog.objectTypes) {
    objectTypeById.set(objectType.id, objectType);
  }

  const lifeCycleById = new Map<LifeCycleId, LifeCycle>();
  for (const lifeCycle of catalog.lifeCycles) {
    lifeCycleById.set(lifeCycle.id, lifeCycle);
  }

  const totalStatesByObjectType = new Map<ObjectTypeId, number>();
  for (const objectType of catalog.objectTypes) {
    let total = 0;
    for (const lifeCycleId of objectType.lifeCycleIds) {
      total += lifeCycleById.get(lifeCycleId)?.states.length ?? 0;
    }
    totalStatesByObjectType.set(objectType.id, total);
  }

  return { catalog, objectTypeById, lifeCycleById, totalStatesByObjectType };
}
