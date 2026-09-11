import type {
  ApiGroupRole,
  ApiKeyedByGroupId,
  ApiObjectLifeCycle,
  ApiObjectType,
  ApiRoleLifeCyclePermission,
  ApiUser,
  ApiUserGroup,
} from '../types/resolver-api.ts';
import type { ResolverDataSource } from './source.ts';
import {
  MOCK_GROUP_ROLES,
  MOCK_GROUP_USERS,
  MOCK_OBJECT_LIFE_CYCLES,
  MOCK_OBJECT_TYPES,
  MOCK_ROLE_LIFE_CYCLE_PERMISSIONS,
  MOCK_USER_GROUPS,
} from './mock/fixtures.ts';

/** Deep-ish copy so a caller mutating a response cannot corrupt the fixtures. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Serves the bundled fixtures. Used when DATA_SOURCE=mock. */
export class MockResolverSource implements ResolverDataSource {
  readonly kind = 'mock' as const;
  readonly callCount = 0;

  async fetchUserGroups(): Promise<ApiUserGroup[]> {
    return clone(MOCK_USER_GROUPS);
  }

  async fetchGroupRoles(): Promise<ApiKeyedByGroupId<ApiGroupRole[]>> {
    return clone(MOCK_GROUP_ROLES);
  }

  async fetchGroupUsers(): Promise<ApiKeyedByGroupId<ApiUser[]>> {
    return clone(MOCK_GROUP_USERS);
  }

  async fetchObjectLifeCycles(includeStates: boolean): Promise<ApiObjectLifeCycle[]> {
    const lifeCycles = clone(MOCK_OBJECT_LIFE_CYCLES);
    if (includeStates) return lifeCycles;
    return lifeCycles.map(({ states: _states, ...rest }) => rest);
  }

  async fetchObjectTypes(): Promise<ApiObjectType[]> {
    return clone(MOCK_OBJECT_TYPES);
  }

  async fetchRoleLifeCyclePermissions(roleId: number): Promise<ApiRoleLifeCyclePermission[]> {
    return clone(MOCK_ROLE_LIFE_CYCLE_PERMISSIONS[roleId] ?? []);
  }
}
