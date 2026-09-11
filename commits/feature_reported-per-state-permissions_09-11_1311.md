# feature:reported-per-state-permissions:09/11 13:11

## What I did
Implemented the endpoints in `update.md`, which replace the central inference
of this app with data the API actually reports.

**The headline: the old view was over-permissive.** I probed the live API before
building. For role *Team Lead* on object type *Action*,
`/data/rolePermissions/role/{roleId}/objectType/{objectTypeId}` returns exactly
one row per state (25 rows for 25 states), and `permission` takes values
0, 1 and 2 — decoded against state names as **none / read / read-and-write**.
That role had level 0 in **19 of its 25 states**, while this app was reporting
"Action: full coverage, 25/25 states reachable". The lifecycle-grant inference
is an upper bound, sometimes a wildly loose one.

So the architecture is now: the **group view stays cheap and derived** (which
object types a role can reach at all), and the **drill-down is authoritative**
(what the API reports per state). Where they disagree, the UI flags it inline
with a "grant overstates" marker and a sentence above the table, rather than
silently preferring one source.

**Also surfaced per state:** the capability flags (create, delete, merge, manage
role, bulk launch), the triggers the role may fire — 6 of the 25 live rows
carried them — and what each state requires before it can be left, from the
`stateRequired` endpoint.

**Frontend.** The old chip track could not carry four independent facts per
state, so the drill-down is now a table: State / Reported access / Can /
Triggers / Requires to exit, in lifecycle order, with a roll-up line above it
("2 read & write · 2 read only · 1 no access · 3 not reported").

**Distinctions the code is careful about**, because conflating them would be
misleading: "no access" (the API reported level 0) is *not* the same as "not
reported" (no row came back), which is *not* the same as "the permissions call
failed" (`permissionsError`, drill-down still renders the grant view flagged as
an upper bound). An unrecognised level renders as "Unrecognised (n)" with the
raw value rather than being rounded down to no-access.

## Notes on the spec vs. reality
- `?deep=true` on `stateRequired` returned a byte-identical payload to the plain
  call on this deployment — not the lifecycle-keyed `states[]` shape in the doc.
  State names/ordinals already come from the catalog call, so the app does not
  need it and does not send it.
- `stateRequired` is **not** `{ data }`-enveloped; it returns its keyed map at
  the top level. The HTTP client grew a `getRaw` for that.
- Trigger **names** are not exposed by any documented endpoint, so the UI shows
  the count with the ids in a tooltip. Worth chasing if you find that endpoint.

## Call budget
Unchanged for the group view (3 + 2 + 1 per distinct role). The drill-down goes
from 0 to **2 cold, 0 warm** — permissions per (role, object type), and exit
requirements per object type shared across roles. Documented in the README and
asserted in `check:live-path`.

## Verification
`npm run check` green: typecheck (3 projects) + 51 data + 28 render + 19
live-path + 7 dev-server = **105 assertions**, up from 79. New coverage includes
the grant-vs-reported contradiction, no-access vs. unreported vs. failed, and
the whole thing end to end against a fake upstream serving the two new
endpoints. `vite build` clean; dev-server module graph clean.

## Files changed
- `src/server/types/resolver-api.ts` — wire types for both new endpoints
- `src/server/http/resolverClient.ts` — `getRaw` for the unenveloped endpoint
- `src/server/data/source.ts`, `liveSource.ts`, `mockSource.ts` — new methods
- `src/server/data/mock/fixtures.ts` — permission + requirement fixtures encoding
  the real discrepancy
- `src/server/domain/normalize.ts` — level decoding, requirement counting
- `src/server/domain/access.ts` — merges reported data, summary, revised caveats
- `src/server/data/repository.ts` — two new caches, graceful degradation
- `src/shared/types/domain.ts` — `StatePermission`, `StateCapabilities`,
  `StateRequirements`, `PermissionSummary`, `PermissionLevel`
- `src/client/components/StatePermissionTable.tsx` — new
- `src/client/components/ObjectTypeDetail.tsx` — table + roll-up + contradiction
- `src/client/styles/app.css` — table styles replace the chip track
- `scripts/smoke.ts`, `render-check.tsx`, `live-path-check.ts` — new coverage
- `update.md` — added to the repo, org id redacted
- `README.md`, `.gitignore` — docs, ignore agent worktrees
