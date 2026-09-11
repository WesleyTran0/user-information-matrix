import { api } from '../services/api.ts';
import { useAsync } from '../hooks/useAsync.ts';
import type {
  LifeCycleAccess,
  ObjectTypeAccessDetail,
  ObjectTypeId,
  RoleId,
} from '../../shared/types/domain.ts';
import { CoverageBadge } from './CoverageBadge.tsx';
import { Message } from './Message.tsx';
import { StatePermissionTable } from './StatePermissionTable.tsx';

function LifeCycleRow({ lifeCycle }: { lifeCycle: LifeCycleAccess }) {
  return (
    <li className={`lifecycle ${lifeCycle.granted ? '' : 'lifecycle--denied'}`}>
      <div className="lifecycle__head">
        <span className="lifecycle__name">{lifeCycle.name}</span>
        <span className={`badge ${lifeCycle.granted ? 'badge--full' : 'badge--none'}`}>
          {lifeCycle.granted ? 'Lifecycle granted' : 'Lifecycle not granted'}
        </span>
      </div>
      {lifeCycle.description !== null && (
        <p className="lifecycle__description">{lifeCycle.description}</p>
      )}
      <StatePermissionTable lifeCycle={lifeCycle} />
    </li>
  );
}

/**
 * Presentational half of the drill-down, split out so it can be rendered
 * against a payload in `npm run check:render`. `renderToString` never runs
 * effects, so anything behind the fetching wrapper below is invisible to that
 * check -- and this is the surface the whole product exists to show.
 */
export function ObjectTypeDetailView({ detail }: { detail: ObjectTypeAccessDetail }) {
  return (
    <div className="detail">
      <div className="detail__head">
        <h4 className="detail__title">{detail.name}</h4>
        <CoverageBadge coverage={detail.coverage} />
        <span className="muted">
          {detail.grantedLifeCycleCount} of {detail.totalLifeCycleCount}{' '}
          {detail.totalLifeCycleCount === 1 ? 'lifecycle' : 'lifecycles'} granted
        </span>
      </div>
      {detail.description !== null && <p className="detail__description">{detail.description}</p>}

      {detail.permissionsError !== null && (
        <p className="warning">
          The per-state permissions could not be loaded, so only the lifecycle grant is shown
          below — treat it as an upper bound. ({detail.permissionsError})
        </p>
      )}

      {detail.permissionSummary.reported && (
        <p className="detail__reported">
          <strong>Reported by the API:</strong>{' '}
          <span className="perm perm--rw">{detail.permissionSummary.readWrite} read &amp; write</span>{' '}
          <span className="perm perm--read">{detail.permissionSummary.read} read only</span>{' '}
          <span className="perm perm--none">{detail.permissionSummary.none} no access</span>
          {detail.permissionSummary.unreported > 0 && (
            <>
              {' '}
              <span className="perm perm--unreported">
                {detail.permissionSummary.unreported} not reported
              </span>
            </>
          )}
        </p>
      )}

      {overstatedCount(detail) > 0 && (
        <p className="warning">
          The lifecycle grant covers {overstatedCount(detail)}{' '}
          {overstatedCount(detail) === 1 ? 'state' : 'states'} where the API reports no access at
          all. The summary above the role list counts those as reachable; this table is the
          authoritative answer.
        </p>
      )}
      <ul className="lifecycle-list">
        {detail.lifeCycles.map((lifeCycle) => (
          <LifeCycleRow key={lifeCycle.lifeCycleId} lifeCycle={lifeCycle} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Detail responses are pure functions of the catalog and the role's cached
 * grants, and cost no upstream call, but re-requesting one on every expand and
 * collapse still means a round trip and a loading flash over unchanged data.
 *
 * Scope of the memo: entries live for the lifetime of the page and are never
 * evicted (bounded by roles x object types). The client does not re-ask, so
 * this copy outlives the server's cache TTL and ignores a server-side cache
 * clear -- reload the page to pick up a changed catalog.
 */
const detailCache = new Map<string, ObjectTypeAccessDetail>();

/** States the grant claims but the API denies -- the gap worth calling out. */
function overstatedCount(detail: ObjectTypeAccessDetail): number {
  let count = 0;
  for (const lifeCycle of detail.lifeCycles) {
    for (const state of lifeCycle.states) {
      if (state.granted && state.permission?.level === 'none') count += 1;
    }
  }
  return count;
}

interface ObjectTypeDetailProps {
  roleId: RoleId;
  objectTypeId: ObjectTypeId;
  panelId: string;
}

export function ObjectTypeDetail({ roleId, objectTypeId, panelId }: ObjectTypeDetailProps) {
  const key = `${roleId}:${objectTypeId}`;
  const cached = detailCache.get(key);

  const request = useAsync(
    cached !== undefined
      ? null
      : async (signal) => {
          const detail = await api.objectTypeDetail(roleId, objectTypeId, signal);
          detailCache.set(key, detail);
          return detail;
        },
    // `cached` also decides whether `load` is null, but it is deliberately not
    // in deps: it only ever transitions undefined -> defined for a given key,
    // and re-running the effect at that moment would refetch what was just
    // stored. `key` changing is the only transition that must refetch.
    [key],
  );

  const detail = cached ?? request.value;

  return (
    <div id={panelId}>
      {detail !== null && detail !== undefined ? (
        <ObjectTypeDetailView detail={detail} />
      ) : request.status === 'error' ? (
        <Message tone="error" title="Could not load permissions" detail={request.error ?? ''} />
      ) : (
        <Message tone="info" title="Loading permissions…" />
      )}
    </div>
  );
}
