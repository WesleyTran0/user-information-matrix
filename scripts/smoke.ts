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

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
