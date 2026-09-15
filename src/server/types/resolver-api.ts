/**
 * Wire types for the Resolver endpoints documented in CLAUDE.md.
 *
 * These mirror the raw JSON exactly, quirks included (`numberOfUsers` arrives
 * as a string, keyed maps arrive with string keys even though the keys are
 * numeric ids). Nothing outside `src/server/domain/normalize.ts` should read
 * these shapes directly -- the rest of the app consumes the domain model.
 */

/** Every documented endpoint wraps its payload in `{ data: ... }`. */
export interface ApiEnvelope<TData> {
  data: TData;
}

/** Map keyed by a stringified group id, as returned by the /user/group/* endpoints. */
export type ApiKeyedByGroupId<TValue> = Record<string, TValue>;

/** GET /user/group */
export interface ApiUserGroup {
  id: number;
  name: string;
  description: string | null;
  created: string;
  modified: string;
  createdBy: number | null;
  modifiedBy: number | null;
  org: number;
  externalRefId: string;
  scimdisplayname: string | null;
  /** Server sends this as a string, e.g. "2". */
  numberOfUsers: string | number | null;
}

/** GET /user/group/roles -- the per-group role entries. */
export interface ApiGroupRole {
  id: number;
  name: string;
  description: string | null;
  isGlobal: boolean;
  created: string;
  modified: string;
  org: number;
  externalRefId: string;
}

/** GET /user/role -- superset of ApiGroupRole with the capability flags. */
export interface ApiRole extends ApiGroupRole {
  nameKey: string | null;
  descriptionKey: string | null;
  canPerformSearch: boolean;
  canQuickCreate: boolean;
  canGetHelp: boolean;
  canSearchArchive: boolean;
}

/** GET /user/group/users */
export interface ApiUser {
  id: number;
  first: string;
  last: string;
  email: string;
  externalRefId: string;
  isActive: boolean;
  userType: number;
  isAdmin: boolean;
  isPortalUrlAccess: boolean;
  lastLogin: string | null;
  lang: string | null;
}

/**
 * GET /object/objectLifeCycle?includeStates=true
 *
 * CLAUDE.md only documents the `includeStates=false` response, so the state
 * shape below is inferred. `normalizeLifeCycleState` reads it defensively and
 * tolerates missing/renamed fields rather than throwing.
 */
export interface ApiObjectLifeCycleState {
  id: number;
  name?: string | null;
  nameKey?: string | null;
  ordinal?: number | null;
  /** Present on some state payloads; carried through untouched when absent. */
  type?: number | null;
  description?: string | null;
  objectLifeCycleId?: number | null;
  externalRefId?: string | null;
}

/** GET /object/objectLifeCycle */
export interface ApiObjectLifeCycle {
  id: number;
  name: string;
  type: number;
  nameKey: string | null;
  description: string | null;
  descriptionKey: string | null;
  created: string;
  modified: string;
  org: number;
  nextStateOrdinal: number;
  externalRefId: string;
  objectTypeId: number | null;
  isSystemConfig: boolean;
  /** Only populated when the request passes includeStates=true. */
  states?: ApiObjectLifeCycleState[];
  /** Some deployments nest states under a plural alias; handled on normalize. */
  objectLifeCycleStates?: ApiObjectLifeCycleState[];
}

/** GET /object/objectType */
export interface ApiObjectType {
  id: number;
  name: string;
  pluralName: string | null;
  description: string | null;
  monogram: string | null;
  nameKey: string | null;
  descriptionKey: string | null;
  pluralNameKey: string | null;
  monogramKey: string | null;
  color: string | null;
  objectLifeCycleId: number | null;
  externalRefId: string;
  created: string;
  modified: string;
  nextElement: number;
  org: number;
  assessment: boolean;
  anchor: unknown;
  anchorRelationship: unknown;
  dataDefinitionId: number | null;
  retentionEnabled: boolean;
  isSystemConfig: boolean;
  isLibraryObjectType: boolean;
}

/** GET /data/rolePermissions/objectLifeCycles/role/{roleId} */
export interface ApiRoleLifeCyclePermission {
  objectLifeCycleId: number;
}

export type ApiUserGroupsResponse = ApiEnvelope<ApiUserGroup[]>;
export type ApiGroupRolesResponse = ApiEnvelope<ApiKeyedByGroupId<ApiGroupRole[]>>;
export type ApiGroupUsersResponse = ApiEnvelope<ApiKeyedByGroupId<ApiUser[]>>;
export type ApiRolesResponse = ApiEnvelope<ApiRole[]>;
export type ApiObjectLifeCyclesResponse = ApiEnvelope<ApiObjectLifeCycle[]>;
export type ApiObjectTypesResponse = ApiEnvelope<ApiObjectType[]>;
export type ApiRoleLifeCyclePermissionsResponse = ApiEnvelope<ApiRoleLifeCyclePermission[]>;

/* -------------------------------------------------------------------------- */
/* Per-state role permissions (documented in update.md)                       */
/* -------------------------------------------------------------------------- */

/** A trigger this role may fire while the object sits in a given state. */
export interface ApiRolePermissionTrigger {
  id: number;
  rolePermissionId: number;
  triggerId: number;
  objectLifeCycleId: number | null;
  org: number;
  externalRefId: string;
}

/**
 * GET /data/rolePermissions/role/{roleId}/objectType/{objectTypeId}
 *
 * One row per lifecycle state. `permission` is an access level, observed as
 * 0 = none, 1 = read, 2 = read and write; the capability flags are separate
 * booleans alongside it. `triggers` is present only on rows that have any.
 */
export interface ApiRolePermissionRow {
  id: number;
  permission: number;
  canBulkLaunch: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canMerge: boolean;
  canManageRole: boolean;
  roleId: number;
  objectTypeId: number;
  objectLifeCycleId: number;
  objectLifeCycleStateId: number;
  formId: number | null;
  org: number;
  externalRefId: string;
  assigned: boolean;
  triggers?: ApiRolePermissionTrigger[];
}

/**
 * GET /object/objectType/{objectTypeId}/objectLifeCycle/stateRequired
 *
 * Keyed by state id. Each row marks something required to leave that state.
 * `type` distinguishes them: rows carrying a `fieldId` require a field, rows
 * carrying a `roleId` require a role assignment. The documented `deep=true`
 * variant returns an identical payload on the deployment we tested, so it is
 * not used.
 */
export interface ApiStateRequiredRow {
  id: number;
  objectLifeCycleStateId: number;
  objectLifeCycleId: number;
  fieldId: number | null;
  relationshipTypeId: number | null;
  propertyId: number | null;
  roleId: number | null;
  type: number;
  org: number;
}

export type ApiRolePermissionsResponse = ApiEnvelope<ApiRolePermissionRow[]>;
/** Not enveloped: this endpoint returns the keyed map at the top level. */
export type ApiStateRequiredResponse = Record<string, ApiStateRequiredRow[]>;

/* -------------------------------------------------------------------------- */
/* Workflow definition: states, triggers, transitions                        */
/* -------------------------------------------------------------------------- */

/** A trigger definition. `id` is what the role-permission rows reference. */
export interface ApiWorkflowTrigger {
  id: number;
  name: string;
  description: string | null;
  type: number;
  isWorkflow: boolean;
  objectLifeCycleId: number;
  externalRefId: string;
}

/** Where firing a trigger can move the object. */
export interface ApiWorkflowTransition {
  id: number;
  name: string | null;
  triggerId: number;
  destinationStateId: number | null;
  objectLifeCycleId: number;
  externalRefId: string;
}

/** A state, carrying the ids of *every* trigger available on it. */
export interface ApiWorkflowState {
  id: number;
  objectLifeCycleId: number;
  name: string;
  ordinal: number | null;
  color: string | null;
  stateCategoryId: number | null;
  creation: boolean;
  /** Ids only; names come from the sibling `triggers` array. */
  triggers?: number[];
}

/**
 * GET /object/objectType/{objectTypeId}/objectLifeCycle/state?deep=true
 *
 * Keyed by lifecycle id, and NOT wrapped in a `{ data }` envelope. This is the
 * only source of trigger *names* and of the full per-state trigger set -- the
 * role-permission rows only report the subset a role may fire.
 */
export type ApiWorkflowResponse = Record<
  string,
  {
    states: ApiWorkflowState[];
    triggers: ApiWorkflowTrigger[];
    transitions: ApiWorkflowTransition[];
  }
>;

/**
 * GET /object/form
 *
 * The org's form definitions, enveloped. Only needed to turn the `formId` on a
 * role-permission row into a name -- one call resolves every form everywhere,
 * so it is fetched once and cached rather than looked up per id.
 */
export interface ApiForm {
  id: number;
  name: string;
  description: string | null;
  type: number;
  objectTypeId: number | null;
  externalRefId: string;
}
