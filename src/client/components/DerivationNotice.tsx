import { useState } from 'react';
import type { DerivationNote } from '../../shared/types/domain.ts';

/**
 * The permission model is inferred, not reported by the API. This says so
 * on-screen rather than letting the UI imply the data is authoritative.
 *
 * A missing-states catalog is raised unconditionally rather than as one more
 * caveat behind the toggle: when it happens, every count on screen reads
 * "0/0 states" and the user needs to know why without clicking.
 */
export function DerivationNotice({ note }: { note: DerivationNote }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className="derivation">
      {!note.statesAvailable && (
        <p className="warning">
          This catalog returned no lifecycle states, so state-level access cannot be shown and
          every state count below reads 0. Check that the upstream honoured includeStates=true.
        </p>
      )}
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
          {note.caveats.map((caveat, index) => (
            // Caveats are a fixed, ordered list per note; index is the stable key.
            // eslint-disable-next-line react/no-array-index-key
            <li key={index}>{caveat}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}
