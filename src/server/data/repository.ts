import type {
  GroupId,
  GroupListItem,
  GroupMatrix,
  LifeCycleId,
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
import { buildCatalog, normalizeRole, normalizeUser, normalizeUserGroup } from '../domain/normalize.ts';
import { DERIVATION_NOTE, buildObjectTypeAccessDetail, buildRoleAccess } from '../domain/access.ts';
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
  readonly #maxConcurrency: number;
  #catalogLoadedAt: string | null = null;

  constructor(source: ResolverDataSource, cacheTtlMs: number, maxConcurrency: number) {
    this.#source = source;
    this.#catalogCache = new TtlCache<CachedCatalog>(cacheTtlMs);
    this.#groupCache = new TtlCache<GroupBundle>(cacheTtlMs);
    this.#rolePermissionCache = new TtlCache<LifeCycleId[]>(cacheTtlMs);
    this.#maxConcurrency = maxConcurrency;
  }

  meta(): ServerMeta {
    return {
      dataSource: this.#source.kind,
      catalogLoadedAt: this.#catalogLoadedAt,
      upstreamCallCount: this.#source.callCount,
      cachedRolePermissionCount: this.#rolePermissionCache.size,
    };
  }

  clearCaches(): void {
    this.#catalogCache.clear();
    this.#groupCache.clear();
    this.#rolePermissionCache.clear();
    this.#catalogLoadedAt = null;
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

      const groups = rawGroups
        .map(normalizeUserGroup)
        .sort((a, b) => a.name.localeCompare(b.name));

      return { groups, rolesByGroupId, usersByGroupId };
    });
  }

  /** 1 upstream call per distinct role, then cached across every group. */
  async #roleGrants(roleId: RoleId): Promise<LifeCycleId[]> {
    return this.#rolePermissionCache.resolve(`role:${roleId}`, async () => {
      const permissions = await this.#source.fetchRoleLifeCyclePermissions(roleId);
      return permissions.map((permission) => permission.objectLifeCycleId);
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
    const grantsByRole = await mapWithConcurrency(roles, this.#maxConcurrency, (role) =>
      this.#roleGrants(role.id),
    );

    const roleAccess: RoleAccess[] = roles.map((role, position) =>
      buildRoleAccess(index, role, grantsByRole[position] ?? []),
    );

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
      derivation: DERIVATION_NOTE,
    };
  }

  /** Served entirely from cache once the role has been fetched -- 0 extra calls. */
  async getObjectTypeDetail(
    roleId: RoleId,
    objectTypeId: ObjectTypeId,
  ): Promise<ObjectTypeAccessDetail> {
    const [index, grants] = await Promise.all([this.#catalog(), this.#roleGrants(roleId)]);
    const detail = buildObjectTypeAccessDetail(index, grants, objectTypeId);
    if (detail === null) {
      throw new NotFoundError(`Object type ${objectTypeId} was not found`);
    }
    return detail;
  }
}
