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
        title="The permissions endpoint returned no row for this state."
      >
        Not reported
      </span>
    );
  }
  const { level, rawLevel } = state.permission;
  return (
    <span
      className={`perm ${LEVEL_CLASS[level]}`}
      title={`Reported by the API as permission=${rawLevel}`}
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
  return (
    <span
      className="cap cap--trigger"
      // Trigger names are not exposed by any documented endpoint, so the ids
      // are the most specific thing that can honestly be shown.
      title={`Trigger ids: ${ids.join(', ')}`}
    >
      {ids.length} {ids.length === 1 ? 'trigger' : 'triggers'}
    </span>
  );
}

function RequirementCell({ state }: { state: StateAccess }) {
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
export function StatePermissionTable({ lifeCycle }: { lifeCycle: LifeCycleAccess }) {
  if (lifeCycle.states.length === 0) {
    return (
      <p className="muted">
        This lifecycle reported no states, so no state-level access can be shown.
      </p>
    );
  }

  return (
    <table className="perm-table">
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
          return (
            <tr key={state.id} className={overstated ? 'perm-row--overstated' : undefined}>
              <th scope="row" className="perm-table__state">
                {state.name}
                {overstated && (
                  <span className="flag" title="The lifecycle grant covers this state, but the API reports no access in it.">
                    grant overstates
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
                <RequirementCell state={state} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
