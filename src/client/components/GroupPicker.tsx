import type { GroupId, GroupListItem } from '../../shared/types/domain.ts';

interface GroupPickerProps {
  groups: GroupListItem[];
  selectedGroupId: GroupId | null;
  onSelect: (groupId: GroupId) => void;
  disabled: boolean;
}

export function GroupPicker({ groups, selectedGroupId, onSelect, disabled }: GroupPickerProps) {
  return (
    <label className="picker">
      <span className="picker__label">User group</span>
      <select
        className="picker__select"
        value={selectedGroupId ?? ''}
        disabled={disabled}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(next)) onSelect(next);
        }}
      >
        <option value="" disabled>
          Select a user group&hellip;
        </option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name} ({group.roleCount} {group.roleCount === 1 ? 'role' : 'roles'})
          </option>
        ))}
      </select>
    </label>
  );
}
