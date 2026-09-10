import type {
  ApiGroupRole,
  ApiObjectLifeCycle,
  ApiObjectLifeCycleState,
  ApiObjectType,
  ApiUser,
  ApiUserGroup,
} from '../../shared/types/resolver-api.ts';
import type {
  Catalog,
  LifeCycle,
  LifeCycleId,
  LifeCycleState,
  ObjectType,
  ObjectTypeId,
  Role,
  User,
  UserGroup,
} from '../../shared/types/domain.ts';

/** `numberOfUsers` arrives as a string; anything unparseable becomes null. */
function toCount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function normalizeUserGroup(raw: ApiUserGroup): UserGroup {
  return {
    id: raw.id,
    name: raw.name,
    description: trimOrNull(raw.description),
    reportedUserCount: toCount(raw.numberOfUsers),
    externalRefId: raw.externalRefId,
    created: raw.created,
    modified: raw.modified,
  };
}

export function normalizeRole(raw: ApiGroupRole): Role {
  return {
    id: raw.id,
    // Several role names carry trailing whitespace upstream.
    name: raw.name.trim(),
    description: trimOrNull(raw.description),
    isGlobal: raw.isGlobal,
    externalRefId: raw.externalRefId,
  };
}

export function normalizeUser(raw: ApiUser): User {
  const firstName = raw.first.trim();
  const lastName = raw.last.trim();
  return {
    id: raw.id,
    firstName,
    lastName,
    fullName: [firstName, lastName].filter((part) => part !== '').join(' '),
    email: raw.email,
    isActive: raw.isActive,
    isAdmin: raw.isAdmin,
    userType: raw.userType,
    lastLogin: raw.lastLogin,
  };
}

/**
 * The state payload is inferred (CLAUDE.md only documents includeStates=false),
 * so read it defensively and fall back to a stable label rather than throwing.
 */
function normalizeLifeCycleState(raw: ApiObjectLifeCycleState): LifeCycleState {
  return {
    id: raw.id,
    name: trimOrNull(raw.name) ?? `State ${raw.id}`,
    ordinal: typeof raw.ordinal === 'number' ? raw.ordinal : null,
  };
}

function readStates(raw: ApiObjectLifeCycle): ApiObjectLifeCycleState[] {
  const states = raw.states ?? raw.objectLifeCycleStates ?? [];
  return Array.isArray(states) ? states : [];
}

export function normalizeLifeCycle(raw: ApiObjectLifeCycle): LifeCycle {
  const states = readStates(raw)
    .map(normalizeLifeCycleState)
    .sort((a, b) => (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER));

  return {
    id: raw.id,
    name: raw.name.trim(),
    description: trimOrNull(raw.description),
    objectTypeId: raw.objectTypeId,
    isSystemConfig: raw.isSystemConfig,
    states,
  };
}

/**
 * Builds the shared catalog.
 *
 * The two directions disagree in practice: an object type points at one
 * `objectLifeCycleId`, while several lifecycles can point back at the same
 * object type. Both are merged into `ObjectType.lifeCycleIds`, which is what
 * coverage is measured against.
 *
 * O(objectTypes + lifeCycles).
 */
export function buildCatalog(
  rawObjectTypes: readonly ApiObjectType[],
  rawLifeCycles: readonly ApiObjectLifeCycle[],
): Catalog {
  const lifeCycles = rawLifeCycles.map(normalizeLifeCycle);

  const lifeCycleIdsByObjectType = new Map<ObjectTypeId, Set<LifeCycleId>>();
  const addBinding = (objectTypeId: ObjectTypeId | null, lifeCycleId: LifeCycleId): void => {
    if (objectTypeId === null) return;
    const existing = lifeCycleIdsByObjectType.get(objectTypeId);
    if (existing === undefined) {
      lifeCycleIdsByObjectType.set(objectTypeId, new Set([lifeCycleId]));
    } else {
      existing.add(lifeCycleId);
    }
  };

  for (const lifeCycle of lifeCycles) {
    addBinding(lifeCycle.objectTypeId, lifeCycle.id);
  }

  const knownLifeCycleIds = new Set(lifeCycles.map((lifeCycle) => lifeCycle.id));
  for (const raw of rawObjectTypes) {
    // Only trust the forward pointer if that lifecycle actually exists.
    if (raw.objectLifeCycleId !== null && knownLifeCycleIds.has(raw.objectLifeCycleId)) {
      addBinding(raw.id, raw.objectLifeCycleId);
    }
  }

  const objectTypes: ObjectType[] = rawObjectTypes.map((raw) => ({
    id: raw.id,
    name: raw.name.trim(),
    pluralName: trimOrNull(raw.pluralName),
    description: trimOrNull(raw.description),
    monogram: trimOrNull(raw.monogram),
    color: trimOrNull(raw.color),
    primaryLifeCycleId: raw.objectLifeCycleId,
    lifeCycleIds: [...(lifeCycleIdsByObjectType.get(raw.id) ?? [])].sort((a, b) => a - b),
    isLibraryObjectType: raw.isLibraryObjectType,
  }));

  return { objectTypes, lifeCycles };
}
