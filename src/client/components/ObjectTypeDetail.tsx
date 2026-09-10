import { api } from '../api/client.ts';
import { useAsync } from '../hooks/useAsync.ts';
import type { LifeCycleAccess, ObjectTypeId, RoleId } from '../../shared/types/domain.ts';
import { CoverageBadge } from './CoverageBadge.tsx';
import { Message } from './Message.tsx';

function LifeCycleRow({ lifeCycle }: { lifeCycle: LifeCycleAccess }) {
  return (
    <li className={`lifecycle ${lifeCycle.granted ? '' : 'lifecycle--denied'}`}>
      <div className="lifecycle__head">
        <span className="lifecycle__name">{lifeCycle.name}</span>
        <span className={`badge ${lifeCycle.granted ? 'badge--full' : 'badge--none'}`}>
          {lifeCycle.granted ? 'Granted' : 'Not granted'}
        </span>
      </div>
      {lifeCycle.description !== null && (
        <p className="lifecycle__description">{lifeCycle.description}</p>
      )}
      {lifeCycle.states.length === 0 ? (
        <p className="muted">
          This lifecycle reported no states, so no state-level access can be shown.
        </p>
      ) : (
        <ol className="state-track">
          {lifeCycle.states.map((state) => (
            <li
              key={state.id}
              className={`state ${state.granted ? 'state--granted' : 'state--denied'}`}
              title={state.granted ? 'Reachable by this role' : 'Not reachable by this role'}
            >
              {state.name}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

interface ObjectTypeDetailProps {
  roleId: RoleId;
  objectTypeId: ObjectTypeId;
}

/**
 * Drill-down for one object type under one role. Costs no upstream API call:
 * the server answers it from the catalog and the role's cached grants.
 */
export function ObjectTypeDetail({ roleId, objectTypeId }: ObjectTypeDetailProps) {
  const detail = useAsync(
    (signal) => api.objectTypeDetail(roleId, objectTypeId, signal),
    [roleId, objectTypeId],
  );

  if (detail.status === 'loading' || detail.status === 'idle') {
    return <Message tone="info" title="Loading permissions…" />;
  }
  if (detail.status === 'error' || detail.value === null) {
    return <Message tone="error" title="Could not load permissions" detail={detail.error ?? ''} />;
  }

  const value = detail.value;

  return (
    <div className="detail">
      <div className="detail__head">
        <h4 className="detail__title">{value.name}</h4>
        <CoverageBadge coverage={value.coverage} />
        <span className="muted">
          {value.grantedLifeCycleCount} of {value.totalLifeCycleCount}{' '}
          {value.totalLifeCycleCount === 1 ? 'lifecycle' : 'lifecycles'} · {value.grantedStateCount}{' '}
          of {value.totalStateCount} states reachable
        </span>
      </div>
      {value.description !== null && <p className="detail__description">{value.description}</p>}
      <ul className="lifecycle-list">
        {value.lifeCycles.map((lifeCycle) => (
          <LifeCycleRow key={lifeCycle.lifeCycleId} lifeCycle={lifeCycle} />
        ))}
      </ul>
    </div>
  );
}
