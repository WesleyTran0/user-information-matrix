import type {
  ApiForm,
  ApiGroupRole,
  ApiKeyedByGroupId,
  ApiObjectLifeCycle,
  ApiObjectType,
  ApiRoleLifeCyclePermission,
  ApiRolePermissionRow,
  ApiStateRequiredResponse,
  ApiUser,
  ApiUserGroup,
  ApiWorkflowResponse,
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
  roleObjectTypePermissions: (roleId: number, objectTypeId: number) =>
    `/data/rolePermissions/role/${roleId}/objectType/${objectTypeId}`,
  stateRequirements: (objectTypeId: number) =>
    `/object/objectType/${objectTypeId}/objectLifeCycle/stateRequired`,
  objectTypeWorkflow: (objectTypeId: number) =>
    `/object/objectType/${objectTypeId}/objectLifeCycle/state?deep=true`,
  forms: '/object/form',
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

  fetchRoleObjectTypePermissions(
    roleId: number,
    objectTypeId: number,
  ): Promise<ApiRolePermissionRow[]> {
    return this.#client.getData<ApiRolePermissionRow[]>(
      RESOLVER_ENDPOINTS.roleObjectTypePermissions(roleId, objectTypeId),
    );
  }

  /** Not enveloped upstream, so this one goes through getRaw. */
  fetchStateRequirements(objectTypeId: number): Promise<ApiStateRequiredResponse> {
    return this.#client.getRaw<ApiStateRequiredResponse>(
      RESOLVER_ENDPOINTS.stateRequirements(objectTypeId),
    );
  }

  /** Also unenveloped: the lifecycle-keyed map is the top-level body. */
  fetchObjectTypeWorkflow(objectTypeId: number): Promise<ApiWorkflowResponse> {
    return this.#client.getRaw<ApiWorkflowResponse>(
      RESOLVER_ENDPOINTS.objectTypeWorkflow(objectTypeId),
    );
  }

  fetchForms(): Promise<ApiForm[]> {
    return this.#client.getData<ApiForm[]>(RESOLVER_ENDPOINTS.forms);
  }
}
