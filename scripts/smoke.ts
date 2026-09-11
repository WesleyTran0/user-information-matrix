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
import type {
  ApiGroupRole,
  ApiKeyedByGroupId,
  ApiObjectLifeCycle,
  ApiObjectType,
  ApiRoleLifeCyclePermission,
  ApiRolePermissionRow,
  ApiStateRequiredResponse,
  ApiUser,
  ApiUserGroup,
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
    escalation?.states.every((state) => state.permission === null) === true,
  );
  check(
    'the summary separates no-access from unreported',
    detail.permissionSummary.readWrite === 2 &&
      detail.permissionSummary.read === 2 &&
      detail.permissionSummary.none === 1 &&
      detail.permissionSummary.unreported === 3 &&
      detail.permissionSummary.reported === true,
    detail.permissionSummary,
  );
  check('no error is reported when the endpoint answered', detail.permissionsError === null);
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
