import { useState } from 'react';
import type { DerivationNote } from '../../shared/types/domain.ts';

/**
 * The permission model is inferred, not reported by the API. This says so
 * on-screen rather than letting the UI imply the data is authoritative.
 */
export function DerivationNotice({ note }: { note: DerivationNote }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className="derivation">
      <div className="derivation__head">
        <span className="derivation__tag">Derived</span>
        <p className="derivation__summary">{note.summary}</p>
        <button
          type="button"
          className="link-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Hide caveats' : 'Caveats'}
        </button>
      </div>
      {expanded && (
        <ul className="derivation__caveats">
          {note.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}
