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

  /** Per-state permissions for one role on one object type. */
  fetchRoleObjectTypePermissions(
    roleId: number,
    objectTypeId: number,
  ): Promise<ApiRolePermissionRow[]>;

  /**
   * Every permission row in the org, in one request.
   *
   * Verified byte-identical to the per-pair endpoint for a sampled pair --
   * same states, levels, capability flags, formId and trigger ids -- so it is
   * a cheaper route to the same data, not a summary of it. Worth ~2,000 calls
   * on an org-wide export; pointless for a single drill-down.
   */
  fetchAllRolePermissions(): Promise<ApiRolePermissionRow[]>;

  /** What each state of an object type requires, keyed by state id. */
  fetchStateRequirements(objectTypeId: number): Promise<ApiStateRequiredResponse>;

  /** States, trigger definitions and transitions for an object type. */
  fetchObjectTypeWorkflow(objectTypeId: number): Promise<ApiWorkflowResponse>;

  /** Every form in the org, for resolving a permission row's formId to a name. */
  fetchForms(): Promise<ApiForm[]>;
}
