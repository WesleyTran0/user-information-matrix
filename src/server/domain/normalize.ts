import type {
  ApiGroupRole,
  ApiObjectLifeCycle,
  ApiRolePermissionRow,
  ApiStateRequiredRow,
  ApiWorkflowResponse,
  ApiWorkflowTrigger,
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
  StateTrigger,
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

/**
 * The permission rows, indexed by state id, plus what it took to get there.
 *
 * `rowCount` matters: the caller can only attach rows to states the catalog
 * knows about, so comparing it against the number attached is the only way to
 * notice that real reported access was dropped on the floor.
 */
export interface NormalizedStatePermissions {
  byStateId: Map<LifeCycleStateId, StatePermission>;
  /** Rows the endpoint returned, before any matching. */
  rowCount: number;
  /** Which lifecycle each row claimed, for diagnosing unmatched rows. */
  lifeCycleIdByStateId: Map<LifeCycleStateId, number>;
  /** Rows folded into an existing state because the state repeated. */
  duplicateCount: number;
}

/** Ranks levels so colliding rows can be reduced to the most permissive. */
const LEVEL_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  'read-write': 2,
  // An unrecognised level outranks nothing; it is surfaced, not compared.
  unknown: -1,
};

function mergePermissions(left: StatePermission, right: StatePermission): StatePermission {
  const keep = LEVEL_RANK[right.level] > LEVEL_RANK[left.level] ? right : left;
  return {
    level: keep.level,
    rawLevel: keep.rawLevel,
    // Capabilities and triggers are additive: holding either row's capability
    // means holding it in that state.
    capabilities: {
      canCreate: left.capabilities.canCreate || right.capabilities.canCreate,
      canDelete: left.capabilities.canDelete || right.capabilities.canDelete,
      canMerge: left.capabilities.canMerge || right.capabilities.canMerge,
      canManageRole: left.capabilities.canManageRole || right.capabilities.canManageRole,
      canBulkLaunch: left.capabilities.canBulkLaunch || right.capabilities.canBulkLaunch,
    },
    triggerIds: [...new Set([...left.triggerIds, ...right.triggerIds])].sort((a, b) => a - b),
    formId: keep.formId,
  };
}

/**
 * Indexes the permission rows by state id. O(rows + triggers).
 *
 * One row per state was observed against the live API, but the payload carries
 * a `formId`, which hints rows could be keyed per (state, form). If several
 * arrive for one state they are merged to the most permissive level with the
 * union of capabilities and triggers, and counted -- silently keeping whichever
 * row happened to be last would understate access.
 */
export function normalizeStatePermissions(
  rows: readonly ApiRolePermissionRow[],
): NormalizedStatePermissions {
  const byStateId = new Map<LifeCycleStateId, StatePermission>();
  const lifeCycleIdByStateId = new Map<LifeCycleStateId, number>();
  let duplicateCount = 0;

  for (const row of rows) {
    const permission: StatePermission = {
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
    };

    const existing = byStateId.get(row.objectLifeCycleStateId);
    if (existing === undefined) {
      byStateId.set(row.objectLifeCycleStateId, permission);
    } else {
      duplicateCount += 1;
      byStateId.set(row.objectLifeCycleStateId, mergePermissions(existing, permission));
    }
    lifeCycleIdByStateId.set(row.objectLifeCycleStateId, row.objectLifeCycleId);
  }

  return { byStateId, rowCount: rows.length, lifeCycleIdByStateId, duplicateCount };
}

/**
 * Collapses the requirement rows into counts per state.
 *
 * Classified by which id the row populates -- a fieldId means a required
 * field, a roleId means a required role assignment -- not by the `type` code,
 * whose full set of values is undocumented. A row can populate more than one,
 * so the counts are not mutually exclusive and need not sum to the row count.
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
      if (row === null || row === undefined) continue;
      if (row.fieldId !== null) fieldCount += 1;
      if (row.roleId !== null) roleCount += 1;
      // Relationship and property requirements, plus anything unrecognised.
      if (row.fieldId === null && row.roleId === null) otherCount += 1;
    }
    byStateId.set(stateId, { fieldCount, roleCount, otherCount });
  }
  return byStateId;
}

/* -------------------------------------------------------------------------- */
/* Workflow definition -> per-state trigger lists                            */
/* -------------------------------------------------------------------------- */

/**
 * Builds the full trigger list for every state of an object type.
 *
 * Three joins happen here: a state's `triggers` array holds ids only, names
 * live in the sibling `triggers` array, and destinations come from
 * `transitions` keyed by trigger id. Several transitions can share a trigger
 * and a destination, so destination names are deduped -- otherwise a trigger
 * with four identical transitions renders "Review / Review / Review / Review".
 *
 * O(states + triggers + transitions).
 */
export function normalizeWorkflowTriggers(
  payload: ApiWorkflowResponse,
): Map<LifeCycleStateId, StateTrigger[]> {
  const byStateId = new Map<LifeCycleStateId, StateTrigger[]>();

  for (const lifeCycle of Object.values(payload)) {
    if (lifeCycle === null || typeof lifeCycle !== 'object') continue;

    const triggerById = new Map<number, ApiWorkflowTrigger>();
    for (const trigger of lifeCycle.triggers ?? []) {
      triggerById.set(trigger.id, trigger);
    }

    const stateNameById = new Map<number, string>();
    for (const state of lifeCycle.states ?? []) {
      stateNameById.set(state.id, state.name);
    }

    const destinationsByTrigger = new Map<number, Set<string>>();
    for (const transition of lifeCycle.transitions ?? []) {
      if (transition.destinationStateId === null) continue;
      const name = stateNameById.get(transition.destinationStateId);
      if (name === undefined) continue;
      const existing = destinationsByTrigger.get(transition.triggerId);
      if (existing === undefined) {
        destinationsByTrigger.set(transition.triggerId, new Set([name]));
      } else {
        existing.add(name);
      }
    }

    for (const state of lifeCycle.states ?? []) {
      const triggers: StateTrigger[] = [];
      for (const triggerId of state.triggers ?? []) {
        const definition = triggerById.get(triggerId);
        triggers.push({
          id: triggerId,
          // An id with no definition still gets a row; hiding it would
          // understate what exists on the state.
          name: definition?.name.trim() ?? `Trigger ${triggerId}`,
          granted: false,
          destinations: [...(destinationsByTrigger.get(triggerId) ?? [])].sort((a, b) =>
            a.localeCompare(b),
          ),
          isWorkflow: definition?.isWorkflow ?? true,
        });
      }
      triggers.sort((a, b) => a.name.localeCompare(b.name));
      byStateId.set(state.id, triggers);
    }
  }

  return byStateId;
}
