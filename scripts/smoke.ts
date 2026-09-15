/**
 * Dependency-free smoke test of the data layer.
 *
 * Runs the mock source through the repository and asserts the derived access
 * model. Node strips the types natively, so this needs no build step:
 *
 *   node scripts/smoke.ts
 */
import { MatrixRepository } from '../src/server/data/repository.ts';
import { MockResolverSource } from '../src/server/data/mockSource.ts';
import type { ResolverDataSource } from '../src/server/data/source.ts';
import { ResolverApiError } from '../src/server/http/resolverClient.ts';
import { TtlCache } from '../src/server/http/cache.ts';
import type {
  ApiGroupRole,
  ApiKeyedByGroupId,
  ApiObjectLifeCycle,
  ApiObjectType,
  ApiRoleLifeCyclePermission,
  ApiRolePermissionRow,
  ApiForm,
  ApiStateRequiredResponse,
  ApiUser,
  ApiUserGroup,
  ApiWorkflowResponse,
} from '../src/server/types/resolver-api.ts';

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}

const repository = new MatrixRepository(new MockResolverSource(), 60_000, 6);

console.log('groups');
const groups = await repository.listGroups();
check('three groups are listed', groups.length === 3, groups.length);
check(
  'role counts are populated',
  groups.every((group) => group.roleCount > 0),
  groups.map((group) => [group.name, group.roleCount]),
);

console.log('\nIncident Supervisor matrix (group 280774)');
const matrix = await repository.getGroupMatrix(280774);
check('group name resolves', matrix.group.name === 'Incident Supervisor', matrix.group.name);
check('three roles', matrix.roles.length === 3, matrix.roles.length);
check('three users', matrix.users.length === 3, matrix.users.length);

const incidentOwner = matrix.roles.find((entry) => entry.role.id === 449698);
check('Incident Owner present', incidentOwner !== undefined);
check(
  'Incident Owner reaches Incident + Corrective Action',
  incidentOwner?.objectTypes.map((entry) => entry.name).join(', ') ===
    'Corrective Action, Incident',
  incidentOwner?.objectTypes.map((entry) => entry.name),
);

const incidentAccess = incidentOwner?.objectTypes.find((entry) => entry.objectTypeId === 450001);
check(
  'Incident is partial coverage (1 of 2 lifecycles)',
  incidentAccess?.coverage === 'partial' &&
    incidentAccess.grantedLifeCycleCount === 1 &&
    incidentAccess.totalLifeCycleCount === 2,
  incidentAccess,
);
check(
  'granted states counted from the granted lifecycle only',
  incidentAccess?.grantedStateCount === 5 && incidentAccess.totalStateCount === 8,
  { granted: incidentAccess?.grantedStateCount, total: incidentAccess?.totalStateCount },
);

const correctiveAction = incidentOwner?.objectTypes.find((entry) => entry.objectTypeId === 450002);
check('Corrective Action is full coverage', correctiveAction?.coverage === 'full', correctiveAction);

const riskChampion = matrix.roles.find((entry) => entry.role.id === 449680);
check(
  'unknown + unbound lifecycles surface as unresolved',
  riskChampion?.unresolvedLifeCycleIds.join(',') === '888888,999001',
  riskChampion?.unresolvedLifeCycleIds,
);

check('object type reach is deduped across roles', matrix.objectTypeReach === 3, matrix.objectTypeReach);

console.log('\ndrill-down: Incident Owner -> Incident');
const detail = await repository.getObjectTypeDetail(449698, 450001);
check('both lifecycles listed', detail.lifeCycles.length === 2, detail.lifeCycles.length);
check('granted lifecycle sorts first', detail.lifeCycles[0]?.granted === true);
check(
  'workflow states are all granted',
  detail.lifeCycles[0]?.states.every((state) => state.granted) === true,
);
check(
  'escalation states are all denied',
  detail.lifeCycles[1]?.states.every((state) => !state.granted) === true,
);
check(
  'states keep lifecycle ordinal order',
  detail.lifeCycles[0]?.states.map((state) => state.name).join(' > ') ===
    'Triage > Open > Investigation > Review > Closed',
  detail.lifeCycles[0]?.states.map((state) => state.name),
);

console.log('\nrole with no grants');
const adminMatrix = await repository.getGroupMatrix(280773);
const commandCenter = adminMatrix.roles.find((entry) => entry.role.id === 449679);
check('Command Center Portal reaches nothing', commandCenter?.objectTypes.length === 0);
check('trailing whitespace trimmed from role names', 
  adminMatrix.roles.some((entry) => entry.role.name === 'VRM - Administrator'));

console.log('\nnot found handling');
const missing = await repository.getGroupMatrix(999999).then(
  () => 'resolved',
  (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
);
check('unknown group rejects with NotFoundError', missing === 'NotFoundError', missing);

/* -------------------------------------------------------------------------- */
/* Regression cases: the object-type <-> lifecycle pointers disagree upstream, */
/* so grant attribution and coverage totals must read the same merged set.     */
/* -------------------------------------------------------------------------- */

/** Minimal source driven by whatever shapes a case needs. */
function sourceOf(parts: {
  objectTypes: ApiObjectType[];
  lifeCycles: ApiObjectLifeCycle[];
  grants: Record<number, ApiRoleLifeCyclePermission[]>;
  roles?: ApiGroupRole[];
  failRoleIds?: number[];
}): ResolverDataSource {
  const roles = parts.roles ?? [buildRole(900)];
  const failRoleIds = new Set(parts.failRoleIds ?? []);
  return {
    kind: 'mock',
    callCount: 0,
    async fetchUserGroups(): Promise<ApiUserGroup[]> {
      return [
        {
          id: 1,
          name: 'Case Group',
          description: null,
          created: 'x',
          modified: 'x',
          createdBy: null,
          modifiedBy: null,
          org: 1,
          externalRefId: 'g1',
          scimdisplayname: null,
          numberOfUsers: '0',
        },
      ];
    },
    async fetchGroupRoles(): Promise<ApiKeyedByGroupId<ApiGroupRole[]>> {
      return { '1': roles };
    },
    async fetchGroupUsers(): Promise<ApiKeyedByGroupId<ApiUser[]>> {
      return { '1': [] };
    },
    async fetchObjectLifeCycles(): Promise<ApiObjectLifeCycle[]> {
      return parts.lifeCycles;
    },
    async fetchObjectTypes(): Promise<ApiObjectType[]> {
      return parts.objectTypes;
    },
    // These cases exercise grant attribution, not reported permissions, so the
    // permission endpoints answer empty -- the drill-down then falls back to
    // the grant-derived view, which is what each case asserts on.
    async fetchRoleObjectTypePermissions(): Promise<ApiRolePermissionRow[]> {
      return [];
    },
    async fetchStateRequirements(): Promise<ApiStateRequiredResponse> {
      return {};
    },
    async fetchObjectTypeWorkflow(): Promise<ApiWorkflowResponse> {
      return {};
    },
    async fetchForms(): Promise<ApiForm[]> {
      return [];
    },
    async fetchAllRolePermissions(): Promise<ApiRolePermissionRow[]> {
      return [];
    },
    async fetchRoleLifeCyclePermissions(roleId: number): Promise<ApiRoleLifeCyclePermission[]> {
      if (failRoleIds.has(roleId)) {
        // The real client throws this type; using it keeps the status mapping
        // in apiErrorHandler on the tested path.
        throw new ResolverApiError(
          `Upstream 403 for /data/rolePermissions/objectLifeCycles/role/${roleId}`,
          403,
          `/data/rolePermissions/objectLifeCycles/role/${roleId}`,
        );
      }
      return parts.grants[roleId] ?? [];
    },
  };
}

function buildRole(id: number): ApiGroupRole {
  return {
    id,
    name: `Role ${id}`,
    description: null,
    isGlobal: false,
    created: 'x',
    modified: 'x',
    org: 1,
    externalRefId: `r${id}`,
  };
}

function buildLifeCycle(
  id: number,
  objectTypeId: number | null,
  stateCount: number,
): ApiObjectLifeCycle {
  return {
    id,
    name: `LifeCycle ${id}`,
    type: 1,
    nameKey: null,
    description: null,
    descriptionKey: null,
    created: 'x',
    modified: 'x',
    org: 1,
    nextStateOrdinal: stateCount,
    externalRefId: `lc${id}`,
    objectTypeId,
    isSystemConfig: false,
    states: Array.from({ length: stateCount }, (_unused, ordinal) => ({
      id: id * 100 + ordinal,
      name: `S${ordinal}`,
      ordinal,
    })),
  };
}

function buildObjectType(id: number, objectLifeCycleId: number | null): ApiObjectType {
  return {
    id,
    name: `Type ${id}`,
    pluralName: null,
    description: null,
    monogram: null,
    nameKey: null,
    descriptionKey: null,
    pluralNameKey: null,
    monogramKey: null,
    color: null,
    objectLifeCycleId,
    externalRefId: `ot${id}`,
    created: 'x',
    modified: 'x',
    nextElement: 1,
    org: 1,
    assessment: false,
    anchor: null,
    anchorRelationship: null,
    dataDefinitionId: null,
    retentionEnabled: false,
    isSystemConfig: false,
    isLibraryObjectType: false,
  };
}

console.log('\nregression: object type points at a lifecycle that points back at nothing');
{
  // ObjectType(10) -> LifeCycle(500), but LifeCycle(500).objectTypeId is null.
  const repo = new MatrixRepository(
    sourceOf({
      objectTypes: [buildObjectType(10, 500)],
      lifeCycles: [buildLifeCycle(500, null, 3)],
      grants: { 900: [{ objectLifeCycleId: 500 }] },
    }),
    60_000,
    6,
  );
  const caseMatrix = await repo.getGroupMatrix(1);
  const role = caseMatrix.roles[0];
  const summaryCoverage = role?.objectTypes[0]?.coverage ?? 'absent';
  const drill = await repo.getObjectTypeDetail(900, 10);
  check(
    'summary attributes the grant to the object type',
    summaryCoverage === 'full',
    { summaryCoverage, unresolved: role?.unresolvedLifeCycleIds },
  );
  check('summary and drill-down agree', summaryCoverage === drill.coverage, {
    summary: summaryCoverage,
    detail: drill.coverage,
  });
  check('nothing is reported unresolved', role?.unresolvedLifeCycleIds.length === 0);
}

console.log('\nregression: two object types point at one lifecycle');
{
  const repo = new MatrixRepository(
    sourceOf({
      objectTypes: [buildObjectType(20, null), buildObjectType(21, 600)],
      lifeCycles: [buildLifeCycle(600, 20, 2)],
      grants: { 900: [{ objectLifeCycleId: 600 }] },
    }),
    60_000,
    6,
  );
  const caseMatrix = await repo.getGroupMatrix(1);
  const names = (caseMatrix.roles[0]?.objectTypes ?? []).map((entry) => entry.name).sort();
  check('both owners are listed', names.join(',') === 'Type 20,Type 21', names);
  check('object type reach counts both', caseMatrix.objectTypeReach === 2, caseMatrix.objectTypeReach);
  const drill = await repo.getObjectTypeDetail(900, 21);
  check('the second owner drills down as full, not partial', drill.coverage === 'full', drill.coverage);
}

console.log('\nregression: a role whose grants fail does not take down the group');
{
  const repo = new MatrixRepository(
    sourceOf({
      objectTypes: [buildObjectType(30, 700)],
      lifeCycles: [buildLifeCycle(700, 30, 2)],
      grants: { 900: [{ objectLifeCycleId: 700 }], 901: [] },
      roles: [buildRole(900), buildRole(901)],
      failRoleIds: [901],
    }),
    60_000,
    6,
  );
  const caseMatrix = await repo.getGroupMatrix(1);
  check('the group still renders', caseMatrix.roles.length === 2);
  check('the healthy role keeps its access', caseMatrix.roles[0]?.objectTypes.length === 1);
  check(
    'the failing role reports why',
    caseMatrix.roles[1]?.grantsError?.includes('403') === true,
    caseMatrix.roles[1]?.grantsError,
  );
}

console.log('\nregression: catalog without states says so');
{
  const repo = new MatrixRepository(
    sourceOf({
      objectTypes: [buildObjectType(40, 800)],
      lifeCycles: [buildLifeCycle(800, 40, 0)],
      grants: { 900: [{ objectLifeCycleId: 800 }] },
    }),
    60_000,
    6,
  );
  const caseMatrix = await repo.getGroupMatrix(1);
  check(
    'the derivation note flags the missing states',
    caseMatrix.derivation.caveats[0]?.includes('no lifecycle states') === true,
    caseMatrix.derivation.caveats[0],
  );
  check('meta flags it too', repo.meta().lifeCycleStatesAvailable === false);
}

console.log('\nthe cache is bounded');
{
  // Permission keys are role x object type, so the key space is quadratic and
  // expiry alone would not bound it -- an expired entry is only dropped when
  // that same key is read again.
  const cache = new TtlCache<number>(60_000, 10);
  for (let index = 0; index < 50; index += 1) cache.set(`k${index}`, index);
  check('it stops growing at the cap', cache.size === 10, cache.size);
  check('and keeps the most recent entries', cache.get('k49') === 49, cache.get('k49'));
  check('evicting the oldest', cache.get('k0') === undefined, cache.get('k0'));
}

console.log('\nreported per-state permissions');
{
  const repo = new MatrixRepository(new MockResolverSource(), 60_000, 6);
  const detail = await repo.getObjectTypeDetail(449698, 450001);
  const workflow = detail.lifeCycles.find((entry) => entry.lifeCycleId === 603174);
  const triage = workflow?.states.find((state) => state.name === 'Triage');
  const open = workflow?.states.find((state) => state.name === 'Open');

  check('the grant still reports the state as covered', triage?.granted === true);
  check(
    'but the reported level overrides it with no access',
    triage?.permission?.level === 'none',
    triage?.permission,
  );
  check(
    'read-write is reported where the API says so',
    open?.permission?.level === 'read-write' && open.permission.rawLevel === 2,
    open?.permission,
  );
  check(
    'capabilities come through per state',
    open?.permission?.capabilities.canCreate === true &&
      open.permission.capabilities.canDelete === false,
    open?.permission?.capabilities,
  );
  check('triggers come through per state', open?.permission?.triggerIds.length === 2,
    open?.permission?.triggerIds);
  check(
    'exit requirements are counted by kind',
    workflow?.states.find((state) => state.name === 'Investigation')?.requirements?.fieldCount ===
      1 &&
      workflow.states.find((state) => state.name === 'Investigation')?.requirements?.roleCount === 1,
    workflow?.states.find((state) => state.name === 'Investigation')?.requirements,
  );

  const escalation = detail.lifeCycles.find((entry) => entry.lifeCycleId === 603272);
  check(
    'states with no reported row stay null, not "no access"',
    escalation !== undefined &&
      escalation.states.length === 3 &&
      escalation.states.every((state) => state.permission === null),
    escalation?.states.length,
  );
  check(
    'the summary separates no-access from unreported',
    detail.permissionSummary.readWrite === 2 &&
      detail.permissionSummary.read === 2 &&
      detail.permissionSummary.none === 1 &&
      detail.permissionSummary.unreported === 3 &&
      detail.permissionSummary.unknown === 0 &&
      detail.permissionSummary.overstatedStates === 1 &&
      detail.permissionSummary.understatedStates === 0 &&
      detail.permissionSummary.reported === true,
    detail.permissionSummary,
  );
  check('no error is reported when the endpoint answered', detail.permissionsError === null);
}

console.log('\nreported rows the catalog cannot place are not dropped silently');
{
  const source = new MockResolverSource();
  // A row for a state id no lifecycle of this object type contains -- the
  // condition the catalog's own two-pointer caveat admits to.
  source.fetchRoleObjectTypePermissions = async (): Promise<ApiRolePermissionRow[]> => [
    { id: 1, permission: 2, canBulkLaunch: false, canCreate: false, canDelete: false,
      canMerge: false, canManageRole: false, roleId: 449698, objectTypeId: 450001,
      objectLifeCycleId: 888001, objectLifeCycleStateId: 77777701, formId: null, org: 1,
      externalRefId: 'x', assigned: false },
  ];
  const repo = new MatrixRepository(source, 60_000, 6);
  const detail = await repo.getObjectTypeDetail(449698, 450001);
  check(
    'a non-empty response never reads as "nothing reported"',
    detail.permissionSummary.reported === true,
    detail.permissionSummary,
  );
  check('the unplaceable row is counted', detail.permissionSummary.unmatchedReportedRows === 1,
    detail.permissionSummary.unmatchedReportedRows);
  check('and its lifecycle is named for diagnosis',
    detail.permissionSummary.unmatchedLifeCycleIds.join(',') === '888001',
    detail.permissionSummary.unmatchedLifeCycleIds);
}

console.log('\nan unrecognised level is not counted as unreported');
{
  const source = new MockResolverSource();
  source.fetchRoleObjectTypePermissions = async (): Promise<ApiRolePermissionRow[]> =>
    [0, 1, 2, 3, 4].map((ordinal) => ({
      id: 100 + ordinal, permission: 7, canBulkLaunch: false, canCreate: false,
      canDelete: false, canMerge: false, canManageRole: false, roleId: 449698,
      objectTypeId: 450001, objectLifeCycleId: 603174,
      objectLifeCycleStateId: 603174 * 100 + ordinal, formId: null, org: 1,
      externalRefId: `u${ordinal}`, assigned: false,
    }));
  const repo = new MatrixRepository(source, 60_000, 6);
  const detail = await repo.getObjectTypeDetail(449698, 450001);
  check('unrecognised levels get their own bucket', detail.permissionSummary.unknown === 5,
    detail.permissionSummary);
  check('they are not folded into "not reported"',
    detail.permissionSummary.unreported === 3, detail.permissionSummary.unreported);
  check('the raw value is preserved per state',
    detail.lifeCycles.flatMap((lc) => lc.states).some((st) => st.permission?.rawLevel === 7));
  check('an unrecognised level is not treated as a contradiction',
    detail.permissionSummary.overstatedStates === 0 &&
      detail.permissionSummary.understatedStates === 0);
}

console.log('\nreported access beyond the grant is flagged, not assumed away');
{
  const source = new MockResolverSource();
  // Role 449698 does NOT hold lifecycle 603272; report write access anyway.
  source.fetchRoleObjectTypePermissions = async (): Promise<ApiRolePermissionRow[]> =>
    [0, 1, 2].map((ordinal) => ({
      id: 200 + ordinal, permission: 2, canBulkLaunch: false, canCreate: false,
      canDelete: false, canMerge: false, canManageRole: false, roleId: 449698,
      objectTypeId: 450001, objectLifeCycleId: 603272,
      objectLifeCycleStateId: 603272 * 100 + ordinal, formId: null, org: 1,
      externalRefId: `o${ordinal}`, assigned: false,
    }));
  const repo = new MatrixRepository(source, 60_000, 6);
  const detail = await repo.getObjectTypeDetail(449698, 450001);
  check('the upper-bound assumption is checked, not trusted',
    detail.permissionSummary.understatedStates === 3,
    detail.permissionSummary.understatedStates);
}

console.log('\nduplicate rows for one state are merged, not last-wins');
{
  const source = new MockResolverSource();
  const base = {
    canBulkLaunch: false, canCreate: false, canDelete: false, canMerge: false,
    canManageRole: false, roleId: 449698, objectTypeId: 450001,
    objectLifeCycleId: 603174, objectLifeCycleStateId: 603174 * 100 + 1, org: 1,
    assigned: false,
  };
  source.fetchRoleObjectTypePermissions = async (): Promise<ApiRolePermissionRow[]> => [
    { ...base, id: 1, permission: 2, canCreate: true, formId: 1, externalRefId: 'a',
      triggers: [{ id: 1, rolePermissionId: 1, triggerId: 11, objectLifeCycleId: 603174,
        org: 1, externalRefId: 't1' }] },
    // Lower level, different capability: last-wins would lose the write access.
    { ...base, id: 2, permission: 1, canDelete: true, formId: 2, externalRefId: 'b',
      triggers: [{ id: 2, rolePermissionId: 2, triggerId: 12, objectLifeCycleId: 603174,
        org: 1, externalRefId: 't2' }] },
  ];
  const repo = new MatrixRepository(source, 60_000, 6);
  const detail = await repo.getObjectTypeDetail(449698, 450001);
  const state = detail.lifeCycles
    .flatMap((lc) => lc.states)
    .find((st) => st.id === 603174 * 100 + 1);
  check('the most permissive level survives', state?.permission?.level === 'read-write',
    state?.permission?.level);
  check('capabilities from both rows are unioned',
    state?.permission?.capabilities.canCreate === true &&
      state.permission.capabilities.canDelete === true,
    state?.permission?.capabilities);
  check('triggers from both rows are unioned',
    state?.permission?.triggerIds.join(',') === '11,12', state?.permission?.triggerIds);
  check('and the collapse is reported', detail.permissionSummary.duplicateReportedRows === 1,
    detail.permissionSummary.duplicateReportedRows);
}

console.log('\na requirements failure is recorded, not shown as "nothing required"');
{
  const source = new MockResolverSource();
  source.fetchStateRequirements = async (): Promise<never> => {
    throw new ResolverApiError('Upstream 500 for stateRequired', 500, '/object/objectType');
  };
  const repo = new MatrixRepository(source, 60_000, 6);
  const detail = await repo.getObjectTypeDetail(449698, 450001);
  check('the drill-down still returns', detail.lifeCycles.length === 2);
  check('and the hole is recorded', detail.requirementsError?.includes('500') === true,
    detail.requirementsError);
  check('while the permissions half is unaffected',
    detail.permissionsError === null && detail.permissionSummary.reported === true);
}

console.log('\nan unknown object type costs nothing');
{
  const repo = new MatrixRepository(new MockResolverSource(), 60_000, 6);
  const outcome = await repo.getObjectTypeDetail(449698, 999991).then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
  );
  const meta = repo.meta();
  check('it is a 404', outcome === 'NotFoundError', outcome);
  check('no permissions call was spent', meta.cachedStatePermissionCount === 0,
    meta.cachedStatePermissionCount);
  check('no requirements call was spent', meta.cachedRequirementCount === 0,
    meta.cachedRequirementCount);
}

console.log('\nexit requirements are fetched once per object type, not once per role');
{
  const source = new MockResolverSource();
  let requirementCalls = 0;
  const inner = source.fetchStateRequirements.bind(source);
  source.fetchStateRequirements = async (objectTypeId: number) => {
    requirementCalls += 1;
    return inner(objectTypeId);
  };
  const repo = new MatrixRepository(source, 60_000, 6);
  await Promise.all([
    repo.getObjectTypeDetail(449698, 450001),
    repo.getObjectTypeDetail(449710, 450001),
    repo.getObjectTypeDetail(449785, 450001),
  ]);
  check('three roles, one requirements call', requirementCalls === 1, requirementCalls);
  check('but three permission calls', repo.meta().cachedStatePermissionCount === 3,
    repo.meta().cachedStatePermissionCount);
}

console.log('\nreported permissions absent or failing');
{
  const repo = new MatrixRepository(new MockResolverSource(), 60_000, 6);
  // 449680 has no permission rows fixtured for Cyber Control.
  const detail = await repo.getObjectTypeDetail(449680, 522608);
  check('an empty response is not an error', detail.permissionsError === null);
  check('nothing is reported', detail.permissionSummary.reported === false,
    detail.permissionSummary);
  check(
    'the grant-derived view still renders',
    detail.lifeCycles.length === 1 && detail.lifeCycles[0]?.granted === true,
  );
}

console.log('\nthe drill-down degrades when permissions fail');
{
  const failing = new MockResolverSource();
  // Override just the permissions call to fail, leaving everything else.
  failing.fetchRoleObjectTypePermissions = async (): Promise<never> => {
    throw new ResolverApiError('Upstream 500 for role permissions', 500, '/data/rolePermissions');
  };
  const repo = new MatrixRepository(failing, 60_000, 6);
  const detail = await repo.getObjectTypeDetail(449698, 450001);
  check('the drill-down still returns', detail.lifeCycles.length === 2);
  check('and says why the levels are missing',
    detail.permissionsError?.includes('500') === true, detail.permissionsError);
  check('with nothing reported', detail.permissionSummary.reported === false);
}

console.log('\nregression: a duplicated object type id does not double-credit a grant');
{
  const duplicated = buildObjectType(50, 900);
  const repo = new MatrixRepository(
    sourceOf({
      objectTypes: [duplicated, { ...duplicated }],
      lifeCycles: [buildLifeCycle(900, 50, 4)],
      grants: { 900: [{ objectLifeCycleId: 900 }] },
    }),
    60_000,
    6,
  );
  const caseMatrix = await repo.getGroupMatrix(1);
  const row = caseMatrix.roles[0]?.objectTypes[0];
  check('the object type appears once', caseMatrix.roles[0]?.objectTypes.length === 1);
  check(
    'granted never exceeds total',
    row !== undefined &&
      row.grantedLifeCycleCount <= row.totalLifeCycleCount &&
      row.grantedStateCount <= row.totalStateCount,
    row,
  );
  const drill = await repo.getObjectTypeDetail(900, 50);
  check(
    'summary and drill-down still agree',
    row?.grantedLifeCycleCount === drill.grantedLifeCycleCount &&
      row?.grantedStateCount === drill.grantedStateCount,
    { summary: row, detail: { lc: drill.grantedLifeCycleCount, st: drill.grantedStateCount } },
  );
}

console.log('\nregression: unknown role ids are rejected, not fetched');
{
  const repo = new MatrixRepository(new MockResolverSource(), 60_000, 6);
  const outcome = await repo.getObjectTypeDetail(111111, 450001).then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
  );
  check('a role in no group is a 404', outcome === 'NotFoundError', outcome);
  check('and it did not occupy a cache slot', repo.meta().cachedRolePermissionCount === 0);
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
