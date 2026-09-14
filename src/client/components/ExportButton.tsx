import { useState } from 'react';
import type { GroupMatrix } from '../../shared/types/domain.ts';

/**
 * Downloads the group's workbook.
 *
 * Fetched as a blob rather than pointed at with an `<a download>`: the server
 * can answer with a JSON error, and a plain link would save that error to disk
 * as a .xlsx. This way a failure is shown instead.
 */

/** Above this, the export is slow enough that it should be a deliberate act. */
export const CONFIRM_THRESHOLD = 100;

/**
 * Upstream calls the export will make on a cold cache: one per (role, object
 * type) pair, plus two per distinct object type. The group matrix itself is
 * already loaded by the time this button is visible, so it is not counted.
 */
export function estimateCalls(matrix: GroupMatrix): number {
  const pairs = matrix.roles.reduce((total, role) => total + role.objectTypes.length, 0);
  return pairs + matrix.objectTypeReach * 2;
}

type Status = 'idle' | 'confirming' | 'working' | 'error';

export function ExportButton({ matrix }: { matrix: GroupMatrix }) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const estimate = estimateCalls(matrix);

  const download = async (): Promise<void> => {
    setStatus('working');
    setError(null);
    try {
      const response = await fetch(`/api/groups/${matrix.group.id}/export`);
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: { message?: string } }).error.message ?? response.status)
            : `Export failed (${response.status})`;
        throw new Error(message);
      }

      const blob = await response.blob();
      // Filename comes from the server's Content-Disposition; the browser only
      // honours it for real navigations, so it is re-derived here.
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = match?.[1] ?? `${matrix.group.name}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);

      setStatus('idle');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed');
      setStatus('error');
    }
  };

  const onClick = (): void => {
    if (status === 'working') return;
    if (status !== 'confirming' && estimate > CONFIRM_THRESHOLD) {
      setStatus('confirming');
      return;
    }
    void download();
  };

  return (
    <div className="export">
      <button
        type="button"
        className="export__button"
        onClick={onClick}
        disabled={status === 'working'}
        title={`Roughly ${estimate} upstream API ${estimate === 1 ? 'call' : 'calls'} on a cold cache; anything already browsed is reused.`}
      >
        {status === 'working'
          ? 'Building workbook…'
          : status === 'confirming'
            ? `Export anyway (~${estimate} API calls)`
            : 'Export to Excel'}
      </button>

      {status === 'confirming' && (
        <p className="muted">
          This group needs about {estimate} upstream calls and may take a while. Click again to
          go ahead.
        </p>
      )}
      {status === 'working' && (
        <p className="muted">
          Fetching per-state permissions for every role and object type in this group.
        </p>
      )}
      {status === 'error' && error !== null && <p className="warning">{error}</p>}
    </div>
  );
}
