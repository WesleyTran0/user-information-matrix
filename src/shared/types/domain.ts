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

/**
 * Access level reported by the API for one role in one state.
 *
 * Observed values upstream: 0 = none, 1 = read, 2 = read and write. Anything
 * unrecognised is surfaced as `unknown` rather than guessed at.
 */
export type PermissionLevel = 'none' | 'read' | 'read-write' | 'unknown';

/** The capability flags that travel alongside the access level. */
export interface StateCapabilities {
  canCreate: boolean;
  canDelete: boolean;
  canMerge: boolean;
  canManageRole: boolean;
  canBulkLaunch: boolean;
}

/**
 * What a role may actually do in one state -- reported by the API, not
 * inferred. Absent when the permissions endpoint returned no row for the
 * state, which is meaningful and is shown as such rather than as "no access".
 */
export interface StatePermission {
  level: PermissionLevel;
  /** The raw upstream value, kept so an unrecognised level is still visible. */
  rawLevel: number;
  capabilities: StateCapabilities;
  /** Trigger ids this role may fire in this state. Names are not exposed. */
  triggerIds: number[];
  formId: number | null;
}

/** What a state requires before it can be left. */
export interface StateRequirements {
  fieldCount: number;
  roleCount: number;
  otherCount: number;
}

/** A lifecycle state plus what the role in question can do in it. */
export interface StateAccess extends LifeCycleState {
  /**
   * Whether the role holds the lifecycle grant covering this state. This is
   * the cheap inference; `permission` is the authoritative answer when present.
   */
  granted: boolean;
  /** Null when the permissions endpoint reported nothing for this state. */
  permission: StatePermission | null;
  requirements: StateRequirements | null;
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

/** Counts of states by reported access level, for the drill-down summary. */
export interface PermissionSummary {
  readWrite: number;
  read: number;
  none: number;
  /** Level outside the known 0/1/2 encoding. Counted apart from `unreported`
   * because "the API said something we do not understand" and "the API said
   * nothing" are different facts. */
  unknown: number;
  /** States for which the endpoint returned no row at all. */
  unreported: number;
  /** True when the endpoint returned at least one row, matched or not. */
  reported: boolean;
  /**
   * Rows the endpoint returned whose state id is not in the merged catalog, so
   * they could not be attached to any state. Non-zero means real reported
   * access is missing from the table below and must be said out loud.
   */
  unmatchedReportedRows: number;
  /** Lifecycles those unmatched rows belonged to, for diagnosis. */
  unmatchedLifeCycleIds: LifeCycleId[];
  /** Rows collapsed because several arrived for the same state. */
  duplicateReportedRows: number;
  /** States the grant covers but the API reports no access in. */
  overstatedStates: number;
  /**
   * States the API grants access in but the lifecycle grant does not cover.
   * The app assumes the grant is an upper bound; this counts violations of
   * that assumption rather than trusting it.
   */
  understatedStates: number;
}

/** Drill-down payload behind a single object type row. */
export interface ObjectTypeAccessDetail extends ObjectTypeAccess {
  description: string | null;
  lifeCycles: LifeCycleAccess[];
  /** Roll-up of the reported per-state permissions across all lifecycles. */
  permissionSummary: PermissionSummary;
  /**
   * Set when the permissions endpoint could not be reached. The lifecycle-grant
   * view is still rendered, flagged as inference-only.
   */
  permissionsError: string | null;
  /**
   * Set when the exit-requirements call failed. Without it an empty
   * requirements cell is indistinguishable from "nothing is required", so the
   * UI needs to know the difference.
   */
  requirementsError: string | null;
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
  /**
   * False when the catalog carried no lifecycle states, which makes every
   * "0/0 states" on screen meaningless. A structured field rather than a
   * caveat string, so the UI can raise it unconditionally instead of leaving
   * it behind a disclosure toggle.
   */
  statesAvailable: boolean;
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
  /** Cached (role, object type) permission responses. */
  cachedStatePermissionCount: number;
  /** Cached per-object-type exit requirements. */
  cachedRequirementCount: number;
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
