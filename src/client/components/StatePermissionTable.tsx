import { useState } from 'react';
import type { LifeCycleAccess, StateAccess, StateTrigger } from '../../shared/types/domain.ts';

/**
 * The verbs a role holds in a state, in the order the Resolver UI shows them.
 *
 * Read and edit come from the access level (1 = read, 2 = read and edit);
 * the rest are the capability flags. They are presented as one list because
 * that is how the product presents them -- splitting the level out into its
 * own column implied it was a different kind of fact, which it is not.
 */
function verbsFor(state: StateAccess): string[] {
  const permission = state.permission;
  if (permission === null) return [];

  const verbs: string[] = [];
  if (permission.level === 'read' || permission.level === 'read-write') verbs.push('read');
  if (permission.level === 'read-write') verbs.push('edit');

  const { capabilities } = permission;
  if (capabilities.canCreate) verbs.push('create');
  if (capabilities.canDelete) verbs.push('delete');
  if (capabilities.canMerge) verbs.push('merge');
  // The API field is `canManageRole`, but what it grants is management of this
  // object type while it sits in this state -- not management of the role.
  if (capabilities.canManageRole) verbs.push('manage');
  if (capabilities.canBulkLaunch) verbs.push('bulk launch');

  return verbs;
}

function CanCell({ state }: { state: StateAccess }) {
  const permission = state.permission;

  if (permission === null) {
    return (
      <span
        className="perm perm--unreported"
        aria-label="Not reported: the permissions endpoint returned no row for this state"
      >
        not reported
      </span>
    );
  }

  if (permission.level === 'unknown') {
    return (
      <span className="perm perm--unknown" aria-label={`Unrecognised access level ${permission.rawLevel}`}>
        unrecognised ({permission.rawLevel})
      </span>
    );
  }

  const verbs = verbsFor(state);
  if (verbs.length === 0) {
    return (
      <span className="perm perm--none" aria-label="No access reported in this state">
        no access
      </span>
    );
  }

  return (
    <span className="cap-list" aria-label={`Can ${verbs.join(', ')}`}>
      {verbs.map((verb) => (
        <span key={verb} className={`cap ${verb === 'edit' || verb === 'read' ? 'cap--access' : ''}`}>
          {verb}
        </span>
      ))}
    </span>
  );
}

function TriggerChip({ trigger }: { trigger: StateTrigger }) {
  const destination =
    trigger.destinations.length === 0 ? '' : ` \u2192 ${trigger.destinations.join(' / ')}`;
  return (
    <span
      className={`trigger ${trigger.granted ? 'trigger--granted' : 'trigger--other'}`}
      title={
        (trigger.granted
          ? 'This role can fire this trigger here'
          : 'Available on this state, but not granted to this role') +
        (trigger.isWorkflow ? '' : ' (automated, not a user action)')
      }
    >
      {trigger.name}
      {destination !== '' && <span className="cap__detail">{destination}</span>}
    </span>
  );
}

/**
 * Every trigger on the state, with the role's own marked.
 *
 * Showing what a role *cannot* fire is the point -- it is what makes "2 of the
 * 4 actions possible here" legible. Real states carry up to ~24 triggers, so
 * the role's are always visible and the rest sit behind a disclosure to keep
 * the table scannable.
 */
function TriggerCell({ state, incomplete }: { state: StateAccess; incomplete: boolean }) {
  const [showAll, setShowAll] = useState(false);

  const granted = state.triggers.filter((trigger) => trigger.granted);
  const others = state.triggers.filter((trigger) => !trigger.granted);

  if (state.triggers.length === 0) {
    return <span className="muted">{incomplete ? 'unknown' : '\u2014'}</span>;
  }

  return (
    <div className="trigger-cell">
      {granted.length === 0 ? (
        <span className="muted">none for this role</span>
      ) : (
        <span className="trigger-list">
          {granted.map((trigger) => (
            <TriggerChip key={trigger.id} trigger={trigger} />
          ))}
        </span>
      )}

      {others.length > 0 && (
        <>
          <button
            type="button"
            className="link-button"
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? 'hide' : `+${others.length} not granted`}
          </button>
          {showAll && (
            <span className="trigger-list">
              {others.map((trigger) => (
                <TriggerChip key={trigger.id} trigger={trigger} />
              ))}
            </span>
          )}
        </>
      )}

      {incomplete && (
        <span className="muted">
          workflow definition unavailable, so this may not be the full list
        </span>
      )}
    </div>
  );
}

/**
 * The form this role sees in this state.
 *
 * "Default" is a real choice in the Resolver UI, not missing data, so it is
 * shown as such. What the default resolves to is not exposed by any endpoint,
 * which is why this does not try to name it.
 */
function FormCell({ state, unavailable }: { state: StateAccess; unavailable: boolean }) {
  if (state.permission === null) return <span className="muted">—</span>;

  const form = state.form;
  if (form === null) {
    return (
      <span className="form form--default" title="This state uses the object type's default form">
        Default
      </span>
    );
  }
  if (form.name !== null) return <span className="form">{form.name}</span>;
  return (
    <span
      className="form form--unresolved"
      title={
        unavailable
          ? 'The form catalog could not be loaded, so only the id is known'
          : 'This form id is not in the form catalog'
      }
    >
      Form {form.id}
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
 * States a role cannot touch are normal -- a workflow is expected to restrict
 * most of its states to a few roles -- so they are shown plainly rather than
 * flagged as a discrepancy against the lifecycle grant.
 */
export function StatePermissionTable({
  lifeCycle,
  requirementsUnavailable = false,
  triggersUnavailable = false,
  formsUnavailable = false,
}: {
  lifeCycle: LifeCycleAccess;
  requirementsUnavailable?: boolean;
  triggersUnavailable?: boolean;
  formsUnavailable?: boolean;
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
          <th scope="col">Can</th>
          <th scope="col">Form</th>
          <th scope="col">Triggers</th>
          <th scope="col">Requires to exit</th>
        </tr>
      </thead>
      <tbody>
        {lifeCycle.states.map((state) => (
          <tr key={state.id}>
            <th scope="row" className="perm-table__state">
              {state.name}
            </th>
            <td>
              <CanCell state={state} />
            </td>
            <td>
              <FormCell state={state} unavailable={formsUnavailable} />
            </td>
            <td>
              <TriggerCell state={state} incomplete={triggersUnavailable} />
            </td>
            <td>
              <RequirementCell state={state} unavailable={requirementsUnavailable} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
