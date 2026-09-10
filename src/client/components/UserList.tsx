import type { User } from '../../shared/types/domain.ts';

function formatLastLogin(value: string | null): string {
  if (value === null) return 'never signed in';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'unknown'
    : `last seen ${parsed.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })}`;
}

export function UserList({ users }: { users: User[] }) {
  if (users.length === 0) {
    return <p className="muted">No users are assigned to this group.</p>;
  }

  return (
    <ul className="user-list">
      {users.map((user) => (
        <li key={user.id} className="user-list__item">
          <span className="user-list__name">
            {user.fullName}
            {!user.isActive && <span className="chip chip--muted">inactive</span>}
            {user.isAdmin && <span className="chip chip--admin">admin</span>}
          </span>
          <span className="user-list__meta">{user.email}</span>
          <span className="user-list__meta">{formatLastLogin(user.lastLogin)}</span>
        </li>
      ))}
    </ul>
  );
}
