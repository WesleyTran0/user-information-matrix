/**
 * The normalized model the server computes and the client renders.
 *
 * Ids stay numeric (they are numeric upstream) but are aliased so signatures
 * read unambiguously -- `getRole(groupId, roleId)` is easy to transpose.
 */

export type GroupId = number;
export type RoleId = number;
export type UserId = number;
export type ObjectTypeId = number;
export type LifeCycleId = number;
export type LifeCycleStateId = number;

export interface UserGroup {
  id: GroupId;
  name: string;
  description: string | null;
  /** Reported by the API; may disagree with `users.length` if the caller lacks visibility. */
  reportedUserCount: number | null;
  externalRefId: string;
  created: string;
  modified: string;
}

export interface Role {
  id: RoleId;
  name: string;
  description: string | null;
  isGlobal: boolean;
  externalRefId: string;
}

export interface User {
  id: UserId;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
  userType: number;
  lastLogin: string | null;
}

export interface LifeCycleState {
  id: LifeCycleStateId;
  name: string;
  ordinal: number | null;
}

export interface LifeCycle {
  id: LifeCycleId;
  name: string;
  description: string | null;
  /** Null when the lifecycle is not bound to an object type (rare, but present upstream). */
  objectTypeId: ObjectTypeId | null;
  isSystemConfig: boolean;
  /** Empty when the upstream call was made without includeStates=true. */
  states: LifeCycleState[];
}

export interface ObjectType {
  id: ObjectTypeId;
  name: string;
  pluralName: string | null;
  description: string | null;
  monogram: string | null;
  color: string | null;
  /** The lifecycle the object type itself points at, when it has one. */
  primaryLifeCycleId: LifeCycleId | null;
  /** Every lifecycle whose objectTypeId points back here, primary included. */
  lifeCycleIds: LifeCycleId[];
  isLibraryObjectType: boolean;
}

/**
 * Static reference data shared by every group: object types and lifecycles.
 * Fetched once per cache window regardless of how many groups are viewed.
 */
export interface Catalog {
  objectTypes: ObjectType[];
  lifeCycles: LifeCycle[];
}

/* -------------------------------------------------------------------------- */
/* Derived access model                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How much of an object type a role can reach.
 * - `full`    : every lifecycle bound to the object type is granted
 * - `partial` : at least one, but not all
 * - `none`    : no lifecycle granted (not surfaced in role summaries)
 */
export type AccessCoverage = 'full' | 'partial' | 'none';

/** A lifecycle state plus whether the role in question reaches it. */
export interface StateAccess extends LifeCycleState {
  granted: boolean;
}

/** One lifecycle of one object type, resolved for one role. */
export interface LifeCycleAccess {
  lifeCycleId: LifeCycleId;
  name: string;
  description: string | null;
  granted: boolean;
  /** Empty if the upstream payload carried no states for this lifecycle. */
  states: StateAccess[];
}

/** Roll-up of one object type for one role, as shown in the role's list. */
export interface ObjectTypeAccess {
  objectTypeId: ObjectTypeId;
  name: string;
  pluralName: string | null;
  monogram: string | null;
  color: string | null;
  coverage: AccessCoverage;
  grantedLifeCycleCount: number;
  totalLifeCycleCount: number;
  grantedStateCount: number;
  totalStateCount: number;
}

/** Drill-down payload behind a single object type row. */
export interface ObjectTypeAccessDetail extends ObjectTypeAccess {
  description: string | null;
  lifeCycles: LifeCycleAccess[];
}

export interface RoleAccess {
  role: Role;
  /** Object types the role can reach, sorted by name. Never includes `none`. */
  objectTypes: ObjectTypeAccess[];
  /**
   * Granted lifecycle ids that could not be attributed to an object type
   * (unknown id, or bound to no object type upstream). Surfaced rather than
   * silently dropped so data gaps stay visible.
   */
  unresolvedLifeCycleIds: LifeCycleId[];
  /**
   * Set when this role's grants could not be fetched. The role then carries no
   * access rather than an empty-looking one, and the rest of the group still
   * renders -- one failing role does not take down the whole view.
   */
  grantsError: string | null;
}

export interface GroupMatrix {
  group: UserGroup;
  users: User[];
  roles: RoleAccess[];
  /** Distinct object types reachable by any role in the group. */
  objectTypeReach: number;
  /** How the access above was derived, rendered as a caveat in the UI. */
  derivation: DerivationNote;
}

/**
 * The Resolver API exposes no per-state permission endpoint. Access is granted
 * at lifecycle granularity, so state-level access is inferred. This note
 * travels with the payload so the UI can say so out loud.
 */
export interface DerivationNote {
  method: 'lifecycle-grant-implies-all-states';
  summary: string;
  caveats: string[];
}

/* -------------------------------------------------------------------------- */
/* API surface between this app's server and its client                        */
/* -------------------------------------------------------------------------- */

export interface GroupListItem {
  id: GroupId;
  name: string;
  description: string | null;
  reportedUserCount: number | null;
  roleCount: number;
}

export interface ServerMeta {
  dataSource: 'mock' | 'live';
  catalogLoadedAt: string | null;
  upstreamCallCount: number;
  cachedRolePermissionCount: number;
  /**
   * False when the catalog carried no lifecycle states at all -- the app then
   * cannot show state-level access, and says so instead of rendering 0/0.
   */
  lifeCycleStatesAvailable: boolean | null;
}

export interface ApiErrorBody {
  error: {
    message: string;
    status: number;
    /** Upstream URL path when the failure came from Resolver, else omitted. */
    upstream?: string;
  };
}
