import type { ObjectTypeId, RoleAccess, RoleId } from '../../shared/types/domain.ts';
import { CoverageBadge } from './CoverageBadge.tsx';
import { ObjectTypeDetail } from './ObjectTypeDetail.tsx';

/** Upstream data reaching a style attribute is validated as a hex colour. */
function safeColor(color: string | null): string | null {
  return color !== null && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : null;
}

export interface Selection {
  roleId: RoleId;
  objectTypeId: ObjectTypeId;
}

interface RoleCardProps {
  entry: RoleAccess;
  expanded: boolean;
  onToggle: (roleId: RoleId) => void;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
}

export function RoleCard({ entry, expanded, onToggle, selection, onSelect }: RoleCardProps) {
  const { role, objectTypes, unresolvedLifeCycleIds, grantsError } = entry;
  const panelId = `role-panel-${role.id}`;

  return (
    <section className="role-card">
      <button
        type="button"
        className="role-card__header"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => onToggle(role.id)}
      >
        <span className={`caret ${expanded ? 'caret--open' : ''}`} aria-hidden="true" />
        <span className="role-card__name">{role.name}</span>
        {role.isGlobal && <span className="chip chip--global">global</span>}
        <span className="role-card__count">
          {entry.grantsError !== null
            ? 'unavailable'
            : `${objectTypes.length} ${objectTypes.length === 1 ? 'object type' : 'object types'}`}
        </span>
      </button>

      {expanded && (
        <div className="role-card__body" id={panelId}>
          {role.description !== null && <p className="role-card__description">{role.description}</p>}

          {grantsError !== null && (
            <p className="warning">
              Permissions for this role could not be loaded, so nothing is shown below.
              Reloading retries it. ({grantsError})
            </p>
          )}

          {objectTypes.length === 0 ? (
            grantsError === null && (
              <p className="muted">
                This role has no object lifecycle grants, so it reaches no object types.
              </p>
            )
          ) : (
            <ul className="object-type-list">
              {objectTypes.map((objectType) => {
                const isSelected =
                  selection !== null &&
                  selection.roleId === role.id &&
                  selection.objectTypeId === objectType.objectTypeId;

                const detailPanelId = `detail-${role.id}-${objectType.objectTypeId}`;

                return (
                  <li key={objectType.objectTypeId}>
                    <button
                      type="button"
                      className={`object-type ${isSelected ? 'object-type--selected' : ''}`}
                      aria-expanded={isSelected}
                      aria-controls={detailPanelId}
                      onClick={() =>
                        onSelect(
                          isSelected
                            ? null
                            : { roleId: role.id, objectTypeId: objectType.objectTypeId },
                        )
                      }
                    >
                      <span
                        className="monogram"
                        style={safeColor(objectType.color) !== null
                          ? { background: safeColor(objectType.color) as string }
                          : {}}
                        aria-hidden="true"
                      >
                        {objectType.monogram ?? objectType.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="object-type__name">{objectType.name}</span>
                      <CoverageBadge
                        coverage={objectType.coverage}
                        title={`${objectType.grantedLifeCycleCount} of ${objectType.totalLifeCycleCount} lifecycles granted`}
                      />
                      <span className="object-type__meta">
                        {objectType.grantedStateCount}/{objectType.totalStateCount} states
                      </span>
                    </button>

                    {isSelected && (
                      <ObjectTypeDetail
                        roleId={role.id}
                        objectTypeId={objectType.objectTypeId}
                        panelId={detailPanelId}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {unresolvedLifeCycleIds.length > 0 && (
            <p className="warning">
              {unresolvedLifeCycleIds.length} granted{' '}
              {unresolvedLifeCycleIds.length === 1 ? 'lifecycle is' : 'lifecycles are'} not bound to
              any object type in the catalog and cannot be attributed:{' '}
              {unresolvedLifeCycleIds.join(', ')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
