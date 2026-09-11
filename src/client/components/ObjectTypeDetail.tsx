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

function LifeCycleRow({
  lifeCycle,
  requirementsUnavailable,
  triggersUnavailable,
}: {
  lifeCycle: LifeCycleAccess;
  requirementsUnavailable: boolean;
  triggersUnavailable: boolean;
}) {
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
      <StatePermissionTable
        lifeCycle={lifeCycle}
        requirementsUnavailable={requirementsUnavailable}
        triggersUnavailable={triggersUnavailable}
      />
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
          <span className="perm perm--rw">{detail.permissionSummary.readWrite} read &amp; edit</span>{' '}
          <span className="perm perm--read">{detail.permissionSummary.read} read only</span>{' '}
          <span className="perm perm--none">{detail.permissionSummary.none} no access</span>
          {detail.permissionSummary.unknown > 0 && (
            <>
              {' '}
              <span className="perm perm--unknown">
                {detail.permissionSummary.unknown} unrecognised
              </span>
            </>
          )}
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

      {detail.permissionSummary.unmatchedReportedRows > 0 && (
        <p className="warning">
          The API reported access for {detail.permissionSummary.unmatchedReportedRows}{' '}
          {detail.permissionSummary.unmatchedReportedRows === 1 ? 'state' : 'states'} that this
          object type&apos;s lifecycles do not contain, so {' '}
          {detail.permissionSummary.unmatchedReportedRows === 1 ? 'it is' : 'they are'} missing from
          the table below. This usually means the object type and lifecycle records disagree
          upstream. Lifecycle{' '}
          {detail.permissionSummary.unmatchedLifeCycleIds.length === 1 ? 'id' : 'ids'}:{' '}
          {detail.permissionSummary.unmatchedLifeCycleIds.join(', ')}.
        </p>
      )}

      {detail.permissionSummary.duplicateReportedRows > 0 && (
        <p className="muted">
          {detail.permissionSummary.duplicateReportedRows} additional{' '}
          {detail.permissionSummary.duplicateReportedRows === 1 ? 'row was' : 'rows were'} returned
          for states that already had one; they were merged to the most permissive level.
        </p>
      )}

      {detail.triggersError !== null && (
        <p className="warning">
          The workflow definition could not be loaded, so trigger names and the full per-state
          trigger list are unavailable — only the triggers this role holds are shown, by id.
          ({detail.triggersError})
        </p>
      )}

      {detail.requirementsError !== null && (
        <p className="warning">
          Exit requirements could not be loaded, so the last column is unknown rather than empty.
          ({detail.requirementsError})
        </p>
      )}

      {detail.permissionSummary.understatedStates > 0 && (
        <p className="muted">
          The API reports access in {detail.permissionSummary.understatedStates}{' '}
          {detail.permissionSummary.understatedStates === 1 ? 'state' : 'states'} belonging to a
          lifecycle that is not in this role&apos;s grant list, so the role list may not show every
          object type this role can reach.
        </p>
      )}

      <ul className="lifecycle-list">
        {detail.lifeCycles.map((lifeCycle) => (
          <LifeCycleRow
            key={lifeCycle.lifeCycleId}
            lifeCycle={lifeCycle}
            requirementsUnavailable={detail.requirementsError !== null}
            triggersUnavailable={detail.triggersError !== null}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Re-requesting a detail on every expand and collapse means a round trip and a
 * loading flash over unchanged data. It also now costs up to two upstream
 * calls on a cold server cache, so memoising matters more than it used to.
 *
 * Scope of the memo: entries live for the lifetime of the page and are never
 * evicted (bounded by roles x object types). The client does not re-ask, so
 * this copy outlives the server's cache TTL and ignores a server-side cache
 * clear -- reload the page to pick up a changed catalog.
 */
const detailCache = new Map<string, ObjectTypeAccessDetail>();

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
          // A detail carrying a transient upstream failure must not be cached,
          // or the row would show the error until a full page reload. The
          // server does not cache the failure either, so reopening retries.
          if (detail.permissionsError === null && detail.requirementsError === null) {
            detailCache.set(key, detail);
          }
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
