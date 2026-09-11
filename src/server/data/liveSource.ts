import type {
  ApiGroupRole,
  ApiKeyedByGroupId,
  ApiObjectLifeCycle,
  ApiObjectType,
  ApiRoleLifeCyclePermission,
  ApiUser,
  ApiUserGroup,
} from '../types/resolver-api.ts';
import type { ResolverClient } from '../http/resolverClient.ts';
import type { ResolverDataSource } from './source.ts';

/** The endpoint paths documented in CLAUDE.md, in one place. */
export const RESOLVER_ENDPOINTS = {
  userGroups: '/user/group',
  groupRoles: '/user/group/roles',
  groupUsers: '/user/group/users',
  objectLifeCycles: (includeStates: boolean) =>
    `/object/objectLifeCycle?includeStates=${includeStates ? 'true' : 'false'}`,
  objectTypes: '/object/objectType',
  roleLifeCyclePermissions: (roleId: number) =>
    `/data/rolePermissions/objectLifeCycles/role/${roleId}`,
} as const;

export class LiveResolverSource implements ResolverDataSource {
  readonly kind = 'live' as const;
  readonly #client: ResolverClient;

  constructor(client: ResolverClient) {
    this.#client = client;
  }

  get callCount(): number {
    return this.#client.callCount;
  }

  fetchUserGroups(): Promise<ApiUserGroup[]> {
    return this.#client.getData<ApiUserGroup[]>(RESOLVER_ENDPOINTS.userGroups);
  }

  fetchGroupRoles(): Promise<ApiKeyedByGroupId<ApiGroupRole[]>> {
    return this.#client.getData<ApiKeyedByGroupId<ApiGroupRole[]>>(RESOLVER_ENDPOINTS.groupRoles);
  }

  fetchGroupUsers(): Promise<ApiKeyedByGroupId<ApiUser[]>> {
    return this.#client.getData<ApiKeyedByGroupId<ApiUser[]>>(RESOLVER_ENDPOINTS.groupUsers);
  }

  fetchObjectLifeCycles(includeStates: boolean): Promise<ApiObjectLifeCycle[]> {
    return this.#client.getData<ApiObjectLifeCycle[]>(
      RESOLVER_ENDPOINTS.objectLifeCycles(includeStates),
    );
  }

  fetchObjectTypes(): Promise<ApiObjectType[]> {
    return this.#client.getData<ApiObjectType[]>(RESOLVER_ENDPOINTS.objectTypes);
  }

  fetchRoleLifeCyclePermissions(roleId: number): Promise<ApiRoleLifeCyclePermission[]> {
    return this.#client.getData<ApiRoleLifeCyclePermission[]>(
      RESOLVER_ENDPOINTS.roleLifeCyclePermissions(roleId),
    );
  }
}
