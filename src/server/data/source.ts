import type {
  ApiGroupRole,
  ApiKeyedByGroupId,
  ApiObjectLifeCycle,
  ApiObjectType,
  ApiRoleLifeCyclePermission,
  ApiUser,
  ApiUserGroup,
} from '../../shared/types/resolver-api.ts';

/**
 * Everything the app needs from upstream, expressed as raw payloads.
 *
 * Both the live API and the bundled fixtures implement this, so the
 * repository, normalizer and access model are exercised identically in
 * mock mode and against the real deployment.
 */
export interface ResolverDataSource {
  readonly kind: 'mock' | 'live';
  /** Upstream requests issued so far; fixtures report 0. */
  readonly callCount: number;

  fetchUserGroups(): Promise<ApiUserGroup[]>;
  fetchGroupRoles(): Promise<ApiKeyedByGroupId<ApiGroupRole[]>>;
  fetchGroupUsers(): Promise<ApiKeyedByGroupId<ApiUser[]>>;
  fetchObjectLifeCycles(includeStates: boolean): Promise<ApiObjectLifeCycle[]>;
  fetchObjectTypes(): Promise<ApiObjectType[]>;
  fetchRoleLifeCyclePermissions(roleId: number): Promise<ApiRoleLifeCyclePermission[]>;
}
