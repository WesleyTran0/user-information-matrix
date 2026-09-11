import type {
  GroupId,
  GroupListItem,
  GroupMatrix,
  LifeCycleId,
  LifeCycleStateId,
  StatePermission,
  StateRequirements,
  StateTrigger,
  ObjectTypeAccessDetail,
  ObjectTypeId,
  Role,
  RoleAccess,
  RoleId,
  ServerMeta,
  User,
  UserGroup,
} from '../../shared/types/domain.ts';
import { TtlCache } from '../http/cache.ts';
import { mapWithConcurrency } from '../http/concurrency.ts';
import { buildCatalogIndex, type CatalogIndex } from '../domain/catalogIndex.ts';
import {
  buildCatalog,
  normalizeRole,
  normalizeStatePermissions,
  normalizeStateRequirements,
  normalizeUser,
  normalizeWorkflowTriggers,
  normalizeUserGroup,
  type NormalizedStatePermissions,
} from '../domain/normalize.ts';
import {
  buildDerivationNote,
  buildObjectTypeAccessDetail,
  buildRoleAccess,
  type ReportedPermissions,
} from '../domain/access.ts';
import type { ResolverDataSource } from './source.ts';

/** Raised when a caller asks for something the dataset does not contain. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Group-scoped data that comes from the three collection-wide /user/group* calls. */
interface GroupBundle {
  groups: UserGroup[];
  rolesByGroupId: Map<GroupId, Role[]>;
  usersByGroupId: Map<GroupId, User[]>;
  /** Every role id reachable through some group; guards the drill-down route. */
  knownRoleIds: Set<RoleId>;
}

interface CachedCatalog {
  index: CatalogIndex;
  loadedAt: string;
}

/**
 * Owns the upstream call budget.
 *
 * Per cache window the app issues:
 *   3 calls  -- /user/group, /user/group/roles, /user/group/users (all groups)
 *   2 calls  -- /object/objectType, /object/objectLifeCycle?includeStates=true
 *   1 call   -- per *distinct* role actually inspected
 *
 * Everything else -- every group view, every object-type drill-down -- is
 * computed from those. Roles shared between groups are fetched once.
 */
export class MatrixRepository {
  readonly #source: ResolverDataSource;
  readonly #catalogCache: TtlCache<CachedCatalog>;
  readonly #groupCache: TtlCache<GroupBundle>;
  readonly #rolePermissionCache: TtlCache<LifeCycleId[]>;
  readonly #statePermissionCache: TtlCache<NormalizedStatePermissions>;
  readonly #requirementsCache: TtlCache<Map<LifeCycleStateId, StateRequirements>>;
  readonly #workflowCache: TtlCache<Map<LifeCycleStateId, StateTrigger[]>>;
  readonly #maxConcurrency: number;
  #catalogLoadedAt: string | null = null;
  #statesAvailable: boolean | null = null;

  constructor(source: ResolverDataSource, cacheTtlMs: number, maxConcurrency: number) {
    this.#source = source;
    this.#catalogCache = new TtlCache<CachedCatalog>(cacheTtlMs);
    this.#groupCache = new TtlCache<GroupBundle>(cacheTtlMs);
    this.#rolePermissionCache = new TtlCache<LifeCycleId[]>(cacheTtlMs);
    this.#statePermissionCache = new TtlCache<NormalizedStatePermissions>(cacheTtlMs);
    this.#requirementsCache = new TtlCache<Map<LifeCycleStateId, StateRequirements>>(cacheTtlMs);
    this.#workflowCache = new TtlCache<Map<LifeCycleStateId, StateTrigger[]>>(cacheTtlMs);
    this.#maxConcurrency = maxConcurrency;
  }

  meta(): ServerMeta {
    return {
      dataSource: this.#source.kind,
      catalogLoadedAt: this.#catalogLoadedAt,
      upstreamCallCount: this.#source.callCount,
      cachedRolePermissionCount: this.#rolePermissionCache.size,
      lifeCycleStatesAvailable: this.#statesAvailable,
      cachedStatePermissionCount: this.#statePermissionCache.size,
      cachedRequirementCount: this.#requirementsCache.size,
      cachedWorkflowCount: this.#workflowCache.size,
    };
  }

  clearCaches(): void {
    this.#catalogCache.clear();
    this.#groupCache.clear();
    this.#rolePermissionCache.clear();
    this.#statePermissionCache.clear();
    this.#requirementsCache.clear();
    this.#workflowCache.clear();
    this.#catalogLoadedAt = null;
    this.#statesAvailable = null;
  }

  /** 2 upstream calls, then cached. */
  async #catalog(): Promise<CatalogIndex> {
    const cached = await this.#catalogCache.resolve('catalog', async () => {
      const [objectTypes, lifeCycles] = await Promise.all([
        this.#source.fetchObjectTypes(),
        this.#source.fetchObjectLifeCycles(true),
      ]);
      const index = buildCatalogIndex(buildCatalog(objectTypes, lifeCycles));
      return { index, loadedAt: new Date().toISOString() };
    });
    this.#catalogLoadedAt = cached.loadedAt;
    this.#statesAvailable = cached.index.statesAvailable;
    return cached.index;
  }

  /** 3 upstream calls, then cached. */
  async #groupBundle(): Promise<GroupBundle> {
    return this.#groupCache.resolve('groups', async () => {
      const [rawGroups, rawRoles, rawUsers] = await Promise.all([
        this.#source.fetchUserGroups(),
        this.#source.fetchGroupRoles(),
        this.#source.fetchGroupUsers(),
      ]);

      const rolesByGroupId = new Map<GroupId, Role[]>();
      for (const [key, roles] of Object.entries(rawRoles)) {
        const groupId = Number.parseInt(key, 10);
        if (!Number.isFinite(groupId)) continue;
        rolesByGroupId.set(
          groupId,
          roles.map(normalizeRole).sort((a, b) => a.name.localeCompare(b.name)),
        );
      }

      const usersByGroupId = new Map<GroupId, User[]>();
      for (const [key, users] of Object.entries(rawUsers)) {
        const groupId = Number.parseInt(key, 10);
        if (!Number.isFinite(groupId)) continue;
        usersByGroupId.set(
          groupId,
          users.map(normalizeUser).sort((a, b) => a.fullName.localeCompare(b.fullName)),
        );
      }

      const knownRoleIds = new Set<RoleId>();
      for (const roles of rolesByGroupId.values()) {
        for (const role of roles) knownRoleIds.add(role.id);
      }

      const groups = rawGroups
        .map(normalizeUserGroup)
        .sort((a, b) => a.name.localeCompare(b.name));

      return { groups, rolesByGroupId, usersByGroupId, knownRoleIds };
    });
  }

  /** 1 upstream call per distinct role, then cached across every group. */
  async #roleGrants(roleId: RoleId): Promise<LifeCycleId[]> {
    return this.#rolePermissionCache.resolve(`role:${roleId}`, async () => {
      const permissions = await this.#source.fetchRoleLifeCyclePermissions(roleId);
      return permissions.map((permission) => permission.objectLifeCycleId);
    });
  }

  /**
   * Reported per-state permissions for one role on one object type.
   *
   * 1 upstream call per (role, object type) pair, then cached. This is the
   * authoritative answer the lifecycle-grant inference only approximates.
   */
  async #statePermissions(
    roleId: RoleId,
    objectTypeId: ObjectTypeId,
  ): Promise<NormalizedStatePermissions> {
    return this.#statePermissionCache.resolve(`perm:${roleId}:${objectTypeId}`, async () => {
      const rows = await this.#source.fetchRoleObjectTypePermissions(roleId, objectTypeId);
      return normalizeStatePermissions(rows);
    });
  }

  /** 1 upstream call per object type, shared across every role. */
  async #stateRequirements(
    objectTypeId: ObjectTypeId,
  ): Promise<Map<LifeCycleStateId, StateRequirements>> {
    return this.#requirementsCache.resolve(`req:${objectTypeId}`, async () => {
      const payload = await this.#source.fetchStateRequirements(objectTypeId);
      return normalizeStateRequirements(payload);
    });
  }

  /**
   * Trigger names and the full per-state trigger set for an object type.
   *
   * 1 upstream call per object type, shared across every role -- the workflow
   * definition does not vary by role, only the granted subset does.
   */
  async #workflowTriggers(
    objectTypeId: ObjectTypeId,
  ): Promise<Map<LifeCycleStateId, StateTrigger[]>> {
    return this.#workflowCache.resolve(`wf:${objectTypeId}`, async () => {
      const payload = await this.#source.fetchObjectTypeWorkflow(objectTypeId);
      return normalizeWorkflowTriggers(payload);
    });
  }

  async listGroups(): Promise<GroupListItem[]> {
    const bundle = await this.#groupBundle();
    return bundle.groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      reportedUserCount: group.reportedUserCount,
      roleCount: bundle.rolesByGroupId.get(group.id)?.length ?? 0,
    }));
  }

  async getGroupMatrix(groupId: GroupId): Promise<GroupMatrix> {
    const [bundle, index] = await Promise.all([this.#groupBundle(), this.#catalog()]);

    const group = bundle.groups.find((candidate) => candidate.id === groupId);
    if (group === undefined) {
      throw new NotFoundError(`User group ${groupId} was not found`);
    }

    const roles = bundle.rolesByGroupId.get(groupId) ?? [];

    // Settle per role: one role whose grants fail to load must not take down
    // the whole group view. Failures are not cached, so a reload retries them.
    const grantsByRole = await mapWithConcurrency(roles, this.#maxConcurrency, async (role) => {
      try {
        return { grants: await this.#roleGrants(role.id), error: null };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.warn(`[repository] grants unavailable for role ${role.id}: ${message}`);
        return { grants: [] as LifeCycleId[], error: message };
      }
    });

    const roleAccess: RoleAccess[] = roles.map((role, position) => {
      const outcome = grantsByRole[position];
      return buildRoleAccess(index, role, outcome?.grants ?? [], outcome?.error ?? null);
    });

    const reachedObjectTypes = new Set<ObjectTypeId>();
    for (const entry of roleAccess) {
      for (const objectType of entry.objectTypes) {
        reachedObjectTypes.add(objectType.objectTypeId);
      }
    }

    return {
      group,
      users: bundle.usersByGroupId.get(groupId) ?? [],
      roles: roleAccess,
      objectTypeReach: reachedObjectTypes.size,
      derivation: buildDerivationNote(index.statesAvailable),
    };
  }

  /**
   * Drill-down for one object type under one role.
   *
   * Costs up to 2 upstream calls on a cold cache: the reported per-state
   * permissions for this (role, object type) pair, and the state requirements
   * for the object type (shared by every role). Both are cached, so reopening
   * the same row is free, and the requirements call is amortised across roles.
   *
   * The role id is checked against roles that actually exist in some group
   * first (already-cached data, 0 calls). Without that, any integer a caller
   * types would spend upstream calls and occupy cache slots forever.
   *
   * If the permissions endpoint fails, the grant-derived view is still
   * returned with `permissionsError` set -- a partial answer beats an error
   * page, as long as the UI is honest about which half is missing.
   */
  async getObjectTypeDetail(
    roleId: RoleId,
    objectTypeId: ObjectTypeId,
  ): Promise<ObjectTypeAccessDetail> {
    // Both existence checks run before anything is fetched, and both read
    // already-cached data. Validating the object type only via the null return
    // of the builder would mean spending the fetches below on an id that does
    // not exist, and caching the result of them forever.
    const [bundle, index] = await Promise.all([this.#groupBundle(), this.#catalog()]);
    if (!bundle.knownRoleIds.has(roleId)) {
      throw new NotFoundError(`Role ${roleId} was not found in any user group`);
    }
    if (!index.objectTypeById.has(objectTypeId)) {
      throw new NotFoundError(`Object type ${objectTypeId} was not found`);
    }

    const [grants, permissions, requirements, workflow] = await Promise.all([
      this.#roleGrants(roleId),
      this.#statePermissions(roleId, objectTypeId).then(
        (value) => ({ value, error: null as string | null }),
        (cause: unknown) => ({
          value: {
            byStateId: new Map<LifeCycleStateId, StatePermission>(),
            rowCount: 0,
            lifeCycleIdByStateId: new Map<LifeCycleStateId, number>(),
            duplicateCount: 0,
          } satisfies NormalizedStatePermissions,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      ),
      // A requirements failure does not fail the page, but it is recorded:
      // an empty cell would otherwise read as "nothing is required".
      this.#stateRequirements(objectTypeId).then(
        (value) => ({ value, error: null as string | null }),
        (cause: unknown) => ({
          value: new Map<LifeCycleStateId, StateRequirements>(),
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      ),
      // Also recorded rather than swallowed: without it the trigger list is
      // the role's own subset, which must not be presented as complete.
      this.#workflowTriggers(objectTypeId).then(
        (value) => ({ value, error: null as string | null }),
        (cause: unknown) => ({
          value: new Map<LifeCycleStateId, StateTrigger[]>(),
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      ),
    ]);

    const reported: ReportedPermissions = {
      byStateId: permissions.value.byStateId,
      requirementsByStateId: requirements.value,
      triggersByStateId: workflow.value,
      rowCount: permissions.value.rowCount,
      lifeCycleIdByStateId: permissions.value.lifeCycleIdByStateId,
      duplicateCount: permissions.value.duplicateCount,
      error: permissions.error,
      requirementsError: requirements.error,
      triggersError: workflow.error,
    };

    const detail = buildObjectTypeAccessDetail(index, grants, objectTypeId, reported);
    if (detail === null) {
      // Unreachable: existence was checked above. Kept so the null branch of
      // the builder is handled rather than asserted away.
      throw new NotFoundError(`Object type ${objectTypeId} was not found`);
    }
    return detail;
  }
}
