/**
 * Render smoke test.
 *
 * Renders the real components with real derived data outside a browser, which
 * catches runtime errors in the component tree that `vite build` cannot. Run
 * via `npm run check:render` (Vite builds it for Node, then executes it).
 *
 * React's SSR output separates adjacent text nodes with `<!-- -->`, so
 * assertions strip those before matching.
 */
import { renderToString } from 'react-dom/server';
import { App } from '../src/client/App.tsx';
import { RoleCard } from '../src/client/components/RoleCard.tsx';
import { UserList } from '../src/client/components/UserList.tsx';
import { DerivationNotice } from '../src/client/components/DerivationNotice.tsx';
import { ObjectTypeDetailView } from '../src/client/components/ObjectTypeDetail.tsx';
import { buildDerivationNote } from '../src/server/domain/access.ts';
import { MatrixRepository } from '../src/server/data/repository.ts';
import { MockResolverSource } from '../src/server/data/mockSource.ts';
import type { RoleAccess } from '../src/shared/types/domain.ts';

let failures = 0;

function expect(label: string, ok: boolean): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures += 1;
}

/** React SSR text-node separators are noise for content assertions. */
function text(html: string): string {
  return html.replaceAll('<!-- -->', '');
}

function requireRole(roles: RoleAccess[], roleId: number): RoleAccess {
  const found = roles.find((entry) => entry.role.id === roleId);
  if (found === undefined) throw new Error(`fixture role ${roleId} is missing`);
  return found;
}

const repository = new MatrixRepository(new MockResolverSource(), 60_000, 6);
const matrix = await repository.getGroupMatrix(280774);

const shell = renderToString(<App />);
expect('app shell renders', shell.includes('User Information Matrix'));
expect('empty state prompts for a group', shell.includes('Select a user group to begin'));

const incidentOwner = requireRole(matrix.roles, 449698);
const card = text(
  renderToString(
    <RoleCard
      entry={incidentOwner}
      expanded
      onToggle={() => {}}
      selection={{ roleId: 449698, objectTypeId: 450001 }}
      onSelect={() => {}}
    />,
  ),
);
expect('role name renders', card.includes('Incident Owner'));
expect(
  'reachable object types render',
  card.includes('Incident') && card.includes('Corrective Action'),
);
expect('partial coverage is badged', card.includes('badge--partial'));
expect('full coverage is badged', card.includes('badge--full'));
expect('granted/total state counts render', card.includes('5/8 states'));
expect(
  'monogram swatch uses the object type colour',
  card.includes('INC') && card.includes('background:#d4574a'),
);
expect('the drilled-down row is marked selected', card.includes('object-type--selected'));

const riskChampion = requireRole(matrix.roles, 449680);
const warned = text(
  renderToString(
    <RoleCard
      entry={riskChampion}
      expanded
      onToggle={() => {}}
      selection={null}
      onSelect={() => {}}
    />,
  ),
);
expect(
  'unattributable grants are surfaced, not dropped',
  warned.includes('888888, 999001') && warned.includes('warning'),
);

const users = text(renderToString(<UserList users={matrix.users} />));
expect(
  'members render with status chips',
  users.includes('Jean Bartik') && users.includes('inactive') && users.includes('admin'),
);

const note = text(renderToString(<DerivationNotice note={matrix.derivation} />));
expect('the derivation is labelled on screen', note.includes('Derived'));

// The drill-down is the surface the product exists to show. renderToString
// never runs effects, so the fetching wrapper would render only a spinner --
// the presentational view is rendered directly against a real payload.
const detail = await repository.getObjectTypeDetail(449698, 450001);
const detailHtml = text(renderToString(<ObjectTypeDetailView detail={detail} />));
expect('granted lifecycle is labelled', detailHtml.includes('Lifecycle granted'));
expect('non-granted lifecycle is labelled', detailHtml.includes('Lifecycle not granted'));
expect('the per-state table renders', detailHtml.includes('perm-table'));
expect(
  'every state of both lifecycles is present',
  ['Triage', 'Open', 'Investigation', 'Review', 'Closed', 'Raised', 'Escalated', 'Resolved'].every(
    (state) => detailHtml.includes(state),
  ),
);

// The reported permission levels -- the whole point of the drill-down.
expect('read & write states are labelled', detailHtml.includes('Read &amp; write'));
expect('read-only states are labelled', detailHtml.includes('Read only'));
expect('no-access states are labelled', detailHtml.includes('No access'));
expect(
  'states with no reported row are distinguished from no-access',
  detailHtml.includes('Not reported'),
);
expect('capability flags render', detailHtml.includes('create') && detailHtml.includes('manage role'));
expect('trigger counts render', detailHtml.includes('2 triggers'));
expect('exit requirements render', detailHtml.includes('1 field') && detailHtml.includes('1 role'));
expect(
  'the reported roll-up renders',
  detailHtml.includes('detail__reported') && detailHtml.includes('2 read &amp; write'),
);

// Triage is granted by the lifecycle but reported as no access. Surfacing
// that contradiction is the reason this feature exists.
expect('a grant the API contradicts is flagged inline', detailHtml.includes('grant overstates'));
expect(
  'and explained above the table',
  detailHtml.includes('reports no access at all'),
);

expect('each lifecycle table is named for assistive tech', detailHtml.includes('<caption'));
expect(
  'trigger ids are in the text, not only a tooltip',
  detailHtml.includes('3193189') || detailHtml.includes('(11, 12)') || /\(\d+, ?\d+\)/.test(detailHtml),
);

// The paths the reviewer found uncovered: an unrecognised level, a failed
// permissions call, a failed requirements call, and a zero-state lifecycle.
{
  const base = await repository.getObjectTypeDetail(449698, 450001);

  const unknownLevel: typeof base = {
    ...base,
    permissionSummary: { ...base.permissionSummary, unknown: 2, readWrite: 0 },
    lifeCycles: base.lifeCycles.map((lifeCycle) => ({
      ...lifeCycle,
      states: lifeCycle.states.map((state) => ({
        ...state,
        permission:
          state.permission === null
            ? null
            : { ...state.permission, level: 'unknown' as const, rawLevel: 7 },
      })),
    })),
  };
  const unknownHtml = text(renderToString(<ObjectTypeDetailView detail={unknownLevel} />));
  expect('an unrecognised level shows the raw value', unknownHtml.includes('Unrecognised (7)'));
  expect('and is counted apart from "not reported"', unknownHtml.includes('2 unrecognised'));

  const failed: typeof base = {
    ...base,
    permissionsError: 'Upstream 500 for /data/rolePermissions',
    requirementsError: 'Upstream 500 for /object/objectType',
  };
  const failedHtml = text(renderToString(<ObjectTypeDetailView detail={failed} />));
  expect('a failed permissions call is stated', failedHtml.includes('could not be loaded'));
  expect(
    'a failed requirements call renders "unknown", not an empty cell',
    failedHtml.includes('unknown rather than empty') && failedHtml.includes('>unknown<'),
  );

  const unplaceable: typeof base = {
    ...base,
    permissionSummary: {
      ...base.permissionSummary,
      unmatchedReportedRows: 2,
      unmatchedLifeCycleIds: [888001],
    },
  };
  expect(
    'reported rows the catalog cannot place are surfaced',
    text(renderToString(<ObjectTypeDetailView detail={unplaceable} />)).includes('888001'),
  );

  const understated: typeof base = {
    ...base,
    permissionSummary: { ...base.permissionSummary, understatedStates: 3 },
  };
  expect(
    'access beyond the grant is surfaced too',
    text(renderToString(<ObjectTypeDetailView detail={understated} />)).includes(
      'does not cover',
    ),
  );

  const stateless: typeof base = {
    ...base,
    lifeCycles: base.lifeCycles.map((lifeCycle) => ({ ...lifeCycle, states: [] })),
  };
  expect(
    'a lifecycle with no states says so instead of rendering an empty table',
    text(renderToString(<ObjectTypeDetailView detail={stateless} />)).includes(
      'reported no states',
    ),
  );
}

// A catalog with no states must warn without the user opening anything.
const degraded = text(renderToString(<DerivationNotice note={buildDerivationNote(false)} />));
expect(
  'a stateless catalog warns unconditionally, not behind the toggle',
  degraded.includes('no lifecycle states') && degraded.includes('warning'),
);
expect(
  'a healthy catalog does not show that warning',
  !text(renderToString(<DerivationNotice note={buildDerivationNote(true)} />)).includes(
    'no lifecycle states',
  ),
);

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
