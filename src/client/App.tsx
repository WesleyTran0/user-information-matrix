import { useMemo, useState } from 'react';
import { api } from './services/api.ts';
import { useAsync } from './hooks/useAsync.ts';
import type { GroupId, RoleId } from '../shared/types/domain.ts';
import { DerivationNotice } from './components/DerivationNotice.tsx';
import { ExportButton } from './components/ExportButton.tsx';
import { GroupPicker } from './components/GroupPicker.tsx';
import { Message } from './components/Message.tsx';
import { RoleCard, type Selection } from './components/RoleCard.tsx';
import { UserList } from './components/UserList.tsx';

export function App() {
  const [selectedGroupId, setSelectedGroupId] = useState<GroupId | null>(null);
  const [expandedRoleIds, setExpandedRoleIds] = useState<ReadonlySet<RoleId>>(new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [roleFilter, setRoleFilter] = useState('');

  const groups = useAsync((signal) => api.groups(signal), []);
  const matrix = useAsync(
    selectedGroupId === null ? null : (signal) => api.groupMatrix(selectedGroupId, signal),
    [selectedGroupId],
  );
  // Refetched once the matrix settles: read before that, /api/meta reports the
  // state from before this group was loaded (and a null catalog on first paint).
  const meta = useAsync((signal) => api.meta(signal), [selectedGroupId, matrix.status]);

  const handleSelectGroup = (groupId: GroupId): void => {
    setSelectedGroupId(groupId);
    setExpandedRoleIds(new Set());
    setSelection(null);
    setRoleFilter('');
  };

  const toggleRole = (roleId: RoleId): void => {
    // State updaters must stay pure -- React may replay them -- so the
    // dependent update is issued alongside, not from inside, the updater.
    const isExpanded = expandedRoleIds.has(roleId);

    setExpandedRoleIds((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(roleId);
      else next.add(roleId);
      return next;
    });

    // Collapsing a role should not leave its drill-down "open" underneath.
    if (isExpanded) {
      setSelection((active) => (active?.roleId === roleId ? null : active));
    }
  };

  const value = matrix.value;

  const visibleRoles = useMemo(() => {
    if (value === null) return [];
    const needle = roleFilter.trim().toLowerCase();
    if (needle === '') return value.roles;
    return value.roles.filter(
      (entry) =>
        entry.role.name.toLowerCase().includes(needle) ||
        entry.objectTypes.some((objectType) => objectType.name.toLowerCase().includes(needle)),
    );
  }, [value, roleFilter]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1 className="app__title">User Information Matrix</h1>
          <p className="app__subtitle">
            User group → roles → object types → lifecycle state access
          </p>
        </div>
        {meta.value !== null && (
          <p className="app__meta">
            <span className={`chip ${meta.value.dataSource === 'live' ? 'chip--live' : 'chip--muted'}`}>
              {meta.value.dataSource} data
            </span>
            {meta.value.upstreamCallCount} upstream {meta.value.upstreamCallCount === 1 ? 'call' : 'calls'} ·{' '}
            {meta.value.cachedRolePermissionCount} roles cached
          </p>
        )}
      </header>

      <main className="app__body">
        <aside className="sidebar">
          {groups.status === 'loading' && <Message tone="info" title="Loading user groups…" />}
          {groups.status === 'error' && (
            <Message tone="error" title="Could not load user groups" detail={groups.error ?? ''} />
          )}
          {groups.value !== null && (
            <GroupPicker
              groups={groups.value}
              selectedGroupId={selectedGroupId}
              onSelect={handleSelectGroup}
              disabled={groups.value.length === 0}
            />
          )}

          {value !== null && (
            <>
              <section className="panel">
                <h2 className="panel__title">{value.group.name}</h2>
                {value.group.description !== null && (
                  <p className="panel__description">{value.group.description}</p>
                )}
                <p className="panel__stats">
                  {value.roles.length} {value.roles.length === 1 ? 'role' : 'roles'} ·{' '}
                  {value.users.length} {value.users.length === 1 ? 'user' : 'users'} ·{' '}
                  {value.objectTypeReach} object{' '}
                  {value.objectTypeReach === 1 ? 'type' : 'types'} reachable
                </p>
                <ExportButton matrix={value} />
                {value.group.reportedUserCount !== null &&
                  value.group.reportedUserCount !== value.users.length && (
                    <p className="warning">
                      The API reports {value.group.reportedUserCount} members but returned{' '}
                      {value.users.length}.
                    </p>
                  )}
              </section>

              <section className="panel">
                <h3 className="panel__title panel__title--small">Members</h3>
                <UserList users={value.users} />
              </section>
            </>
          )}
        </aside>

        <section className="content">
          {selectedGroupId === null && (
            <Message
              tone="info"
              title="Select a user group to begin"
              detail="Roles, the object types each role can reach, and the lifecycle states behind them will appear here."
            />
          )}
          {matrix.status === 'loading' && <Message tone="info" title="Building matrix…" />}
          {matrix.status === 'error' && (
            <Message tone="error" title="Could not load this group" detail={matrix.error ?? ''} />
          )}

          {value !== null && (
            <>
              <DerivationNotice note={value.derivation} />

              <div className="toolbar">
                <h2 className="toolbar__title">Roles</h2>
                <input
                  type="search"
                  className="toolbar__search"
                  placeholder="Filter by role or object type"
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                />
              </div>

              {visibleRoles.length === 0 ? (
                <Message
                  tone="info"
                  title={
                    value.roles.length === 0
                      ? 'This group has no roles.'
                      : 'No roles match that filter.'
                  }
                />
              ) : (
                visibleRoles.map((entry) => (
                  <RoleCard
                    key={entry.role.id}
                    entry={entry}
                    expanded={expandedRoleIds.has(entry.role.id)}
                    onToggle={toggleRole}
                    selection={selection}
                    onSelect={setSelection}
                  />
                ))
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
