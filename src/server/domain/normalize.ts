import type {
  ApiGroupRole,
  ApiObjectLifeCycle,
  ApiRolePermissionRow,
  ApiStateRequiredRow,
  ApiObjectLifeCycleState,
  ApiObjectType,
  ApiUser,
  ApiUserGroup,
} from '../types/resolver-api.ts';
import type {
  Catalog,
  LifeCycle,
  LifeCycleId,
  LifeCycleState,
  LifeCycleStateId,
  PermissionLevel,
  StatePermission,
  StateRequirements,
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
    // Null rather than a dangling id when the pointed-at lifecycle is absent
    // from the catalog -- the same condition that excludes it from lifeCycleIds.
    primaryLifeCycleId:
      raw.objectLifeCycleId !== null && knownLifeCycleIds.has(raw.objectLifeCycleId)
        ? raw.objectLifeCycleId
        : null,
    lifeCycleIds: [...(lifeCycleIdsByObjectType.get(raw.id) ?? [])].sort((a, b) => a - b),
    isLibraryObjectType: raw.isLibraryObjectType,
  }));

  return { objectTypes, lifeCycles };
}

/* -------------------------------------------------------------------------- */
/* Reported per-state permissions                                             */
/* -------------------------------------------------------------------------- */

/**
 * Upstream reports the access level as a bare integer. Observed values are
 * 0, 1 and 2; anything else maps to `unknown` so an unrecognised level is
 * visible rather than silently downgraded to "no access".
 */
function toPermissionLevel(raw: number): PermissionLevel {
  switch (raw) {
    case 0:
      return 'none';
    case 1:
      return 'read';
    case 2:
      return 'read-write';
    default:
      return 'unknown';
  }
}

/** Indexes the permission rows by state id. O(rows + triggers). */
export function normalizeStatePermissions(
  rows: readonly ApiRolePermissionRow[],
): Map<LifeCycleStateId, StatePermission> {
  const byStateId = new Map<LifeCycleStateId, StatePermission>();
  for (const row of rows) {
    byStateId.set(row.objectLifeCycleStateId, {
      level: toPermissionLevel(row.permission),
      rawLevel: row.permission,
      capabilities: {
        canCreate: row.canCreate,
        canDelete: row.canDelete,
        canMerge: row.canMerge,
        canManageRole: row.canManageRole,
        canBulkLaunch: row.canBulkLaunch,
      },
      // Only rows that have any triggers carry the array at all.
      triggerIds: (row.triggers ?? []).map((trigger) => trigger.triggerId),
      formId: row.formId,
    });
  }
  return byStateId;
}

/**
 * Collapses the requirement rows into counts per state.
 *
 * `type` distinguishes the kinds: rows carrying a fieldId require a field,
 * rows carrying a roleId require a role assignment. Anything else is counted
 * separately rather than guessed at.
 */
export function normalizeStateRequirements(
  payload: Record<string, readonly ApiStateRequiredRow[]>,
): Map<LifeCycleStateId, StateRequirements> {
  const byStateId = new Map<LifeCycleStateId, StateRequirements>();
  for (const [key, rows] of Object.entries(payload)) {
    const stateId = Number.parseInt(key, 10);
    if (!Number.isFinite(stateId) || !Array.isArray(rows)) continue;

    let fieldCount = 0;
    let roleCount = 0;
    let otherCount = 0;
    for (const row of rows) {
      if (row.fieldId !== null) fieldCount += 1;
      else if (row.roleId !== null) roleCount += 1;
      else otherCount += 1;
    }
    byStateId.set(stateId, { fieldCount, roleCount, otherCount });
  }
  return byStateId;
}
