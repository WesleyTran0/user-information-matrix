import type { LifeCycleAccess, PermissionLevel, StateAccess } from '../../shared/types/domain.ts';

const LEVEL_LABEL: Record<PermissionLevel, string> = {
  'read-write': 'Read & write',
  read: 'Read only',
  none: 'No access',
  unknown: 'Unrecognised',
};

const LEVEL_CLASS: Record<PermissionLevel, string> = {
  'read-write': 'perm--rw',
  read: 'perm--read',
  none: 'perm--none',
  unknown: 'perm--unknown',
};

/** Capability flags in the order they are shown. */
const CAPABILITIES = [
  ['canCreate', 'create'],
  ['canDelete', 'delete'],
  ['canMerge', 'merge'],
  ['canManageRole', 'manage role'],
  ['canBulkLaunch', 'bulk launch'],
] as const;

function AccessCell({ state }: { state: StateAccess }) {
  if (state.permission === null) {
    return (
      <span
        className="perm perm--unreported"
        aria-label="Not reported: the permissions endpoint returned no row for this state"
      >
        Not reported
      </span>
    );
  }
  const { level, rawLevel } = state.permission;
  return (
    <span
      className={`perm ${LEVEL_CLASS[level]}`}
      aria-label={`${LEVEL_LABEL[level]}, reported by the API as permission=${rawLevel}`}
    >
      {LEVEL_LABEL[level]}
      {level === 'unknown' && ` (${rawLevel})`}
    </span>
  );
}

function CapabilityCell({ state }: { state: StateAccess }) {
  if (state.permission === null) return <span className="muted">—</span>;
  const held = CAPABILITIES.filter(([key]) => state.permission?.capabilities[key] === true);
  if (held.length === 0) return <span className="muted">—</span>;
  return (
    <span className="cap-list">
      {held.map(([key, label]) => (
        <span key={key} className="cap">
          {label}
        </span>
      ))}
    </span>
  );
}

function TriggerCell({ state }: { state: StateAccess }) {
  const ids = state.permission?.triggerIds ?? [];
  if (ids.length === 0) return <span className="muted">—</span>;
  // Trigger names are not exposed by any documented endpoint, so the ids are
  // the most specific thing that can honestly be shown. They go in the text,
  // not only in a title, so they survive a screen reader and a touch device.
  return (
    <span className="cap cap--trigger">
      {ids.length} {ids.length === 1 ? 'trigger' : 'triggers'}
      <span className="cap__detail"> ({ids.join(', ')})</span>
    </span>
  );
}

function RequirementCell({
  state,
  unavailable,
}: {
  state: StateAccess;
  unavailable: boolean;
}) {
  // An empty cell would read as "nothing is required", which is a different
  // claim from "the requirements call failed".
  if (unavailable) return <span className="muted">unknown</span>;
  const requirements = state.requirements;
  if (requirements === null) return <span className="muted">—</span>;
  const parts: string[] = [];
  if (requirements.fieldCount > 0) {
    parts.push(`${requirements.fieldCount} field${requirements.fieldCount === 1 ? '' : 's'}`);
  }
  if (requirements.roleCount > 0) {
    parts.push(`${requirements.roleCount} role${requirements.roleCount === 1 ? '' : 's'}`);
  }
  if (requirements.otherCount > 0) parts.push(`${requirements.otherCount} other`);
  return parts.length === 0 ? <span className="muted">—</span> : <>{parts.join(', ')}</>;
}

/**
 * One lifecycle rendered as a state-by-state permission table.
 *
 * A table rather than the old chip track because each state now carries four
 * independent facts (level, capabilities, triggers, requirements) that need to
 * line up for scanning down a column.
 */
export function StatePermissionTable({
  lifeCycle,
  requirementsUnavailable = false,
}: {
  lifeCycle: LifeCycleAccess;
  requirementsUnavailable?: boolean;
}) {
  if (lifeCycle.states.length === 0) {
    return (
      <p className="muted">
        This lifecycle reported no states, so no state-level access can be shown.
      </p>
    );
  }

  return (
    <table className="perm-table">
      {/* Named so table navigation can tell several lifecycles apart; the
          visible heading lives in a sibling element. */}
      <caption className="visually-hidden">
        States of the {lifeCycle.name} lifecycle and what this role may do in each
      </caption>
      <thead>
        <tr>
          <th scope="col">State</th>
          <th scope="col">Reported access</th>
          <th scope="col">Can</th>
          <th scope="col">Triggers</th>
          <th scope="col">Requires to exit</th>
        </tr>
      </thead>
      <tbody>
        {lifeCycle.states.map((state) => {
          // The grant said reachable, the API says otherwise -- worth flagging
          // inline, since the summary above is built from the grant.
          const overstated = state.granted && state.permission?.level === 'none';
          const understated =
            !state.granted &&
            state.permission !== null &&
            state.permission.level !== 'none' &&
            state.permission.level !== 'unknown';
          return (
            <tr
              key={state.id}
              className={overstated || understated ? 'perm-row--contradiction' : undefined}
            >
              <th scope="row" className="perm-table__state">
                {state.name}
                {overstated && (
                  <span className="flag">
                    grant overstates
                    <span className="cap__detail">
                      {' '}
                      — the lifecycle grant covers this state, but the API reports no access
                    </span>
                  </span>
                )}
                {understated && (
                  <span className="flag">
                    grant understates
                    <span className="cap__detail">
                      {' '}
                      — the API reports access here, but the lifecycle grant does not cover it
                    </span>
                  </span>
                )}
              </th>
              <td>
                <AccessCell state={state} />
              </td>
              <td>
                <CapabilityCell state={state} />
              </td>
              <td>
                <TriggerCell state={state} />
              </td>
              <td>
                <RequirementCell state={state} unavailable={requirementsUnavailable} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
