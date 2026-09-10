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
expect('monogram swatch uses the object type colour', card.includes('INC'));
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

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
