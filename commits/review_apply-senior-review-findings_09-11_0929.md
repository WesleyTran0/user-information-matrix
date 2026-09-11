# review:apply-senior-review-findings:09/11 09:29

## What I did
Applied the senior code review of the data layer. Verdict was FIX FIRST; every
finding below is now fixed and covered by a regression test that reproduces the
reviewer's exact scenario.

**1 (HIGH) — grant attribution and coverage totals read different sources.**
`buildCatalog` derived `ObjectType.lifeCycleIds` from the *union* of both
upstream pointers (`objectType.objectLifeCycleId` and `objectLifeCycle.objectTypeId`),
but `buildRoleAccess` attributed a grant using only the reverse pointer. The
numerator and denominator came from different sets, so two real cases produced
self-contradicting output: a lifecycle with `objectTypeId: null` that an object
type points at was reported as "unattributable" in the group view while its
drill-down claimed full access to every state; and when two object types point
at one lifecycle, only one of them appeared in the role's list while the other
still drilled down as full. `CatalogIndex` now exposes
`objectTypeIdsByLifeCycle`, inverted from the *same* merged bindings the totals
use, and attribution goes through it — a grant can no longer be counted against
a denominator it is not part of. A lifecycle owned by two object types now
correctly grants both.

**2 (MED) — unknown role ids spent an upstream call.** `/api/roles/:roleId/...`
only shape-validated the id, so any integer burned one call from the per-role
budget, cached it forever, and returned a plausible 200. It now checks the id
against roles that exist in some group (already-cached data, 0 extra calls) and
404s otherwise.

**3 (MED) — one failing role took down the whole group view.** Grant fetching was
`Promise.all`-backed. It now settles per role: the failure lands on that role as
`grantsError`, the rest of the group renders normally, and because failures are
never cached a reload retries. The UI shows the reason on the affected role.

**4 (MED) — silent degradation to a stateless matrix.** If upstream ever stops
returning lifecycle states, every lifecycle would normalize to `states: []` and
the app would cheerfully render "full, 0/0 states" for everything. The catalog
index now computes `statesAvailable`; when false the derivation note leads with
a caveat naming the likely cause and `/api/meta` reports it, which the header
surfaces as a badge.

**5 (LOW-MED) — unmatched /api routes broke the error contract.** They returned
Express's HTML page in dev, and in production the SPA catch-all would have
answered them with index.html and **status 200**. A terminal handler in the API
router now 404s in the JSON contract. Verified in both modes.

**6 (LOW) — unauthenticated cache invalidation.** `POST /api/cache/clear` forces a
full re-fetch. It is now mounted only outside production.

**7 (LOW) — wire types leaked to the client.** `src/shared/index.ts` re-exported
`resolver-api.ts`, contradicting its own stated boundary. It now exports domain
types only.

**8 (LOW) — `primaryLifeCycleId` could dangle**, pointing at a lifecycle absent
from the catalog. Now null under the same condition that excludes it from
`lifeCycleIds`.

**9 (nits)** — `PORT="8787abc"` no longer parses as 8787; `EADDRINUSE` now prints
a readable message instead of a raw stack (`listen` reports it asynchronously,
so the try/catch around `main()` never saw it). `scripts/smoke.ts` was already
brought under `tsconfig.scripts.json` in the previous commit.

**Also: the reviewer caught a process failure of mine.** `commits/` had been
added to `.gitignore`, so two of my three commit docs were silently skipped by
`git add -A`. I did not write that line, but I committed without checking what
landed. Removed from `.gitignore`; both missing docs are included here.

**Verification.** `npm run check` green: typecheck (3 projects), 31 data-layer
assertions (up from 20 — six new regression cases, each reproducing a reviewer
scenario), 12 render assertions. `vite build` clean. Server exercised over HTTP
in dev and production: JSON 404 for unmatched /api in both, 404 for an unknown
role with no cache slot consumed, cache-clear present in dev and absent in prod,
SPA routes still served, friendly port-conflict message.

Not changed: `fetchObjectLifeCycles(false)` is unused, but it is an accurate
model of the documented endpoint and the mock honours it, so I left it.

## Files changed
- `src/server/domain/catalogIndex.ts` — `objectTypeIdsByLifeCycle`, `statesAvailable`
- `src/server/domain/access.ts` — attribution via the merged index; `buildDerivationNote`
- `src/server/domain/normalize.ts` — `primaryLifeCycleId` nulled when dangling
- `src/server/data/repository.ts` — role-id validation, per-role settle, state reporting
- `src/server/routes/api.ts` — terminal JSON 404, gated cache control
- `src/server/index.ts` — gating wired, async listen error handling
- `src/server/env.ts` — strict integer parsing
- `src/shared/types/domain.ts` — `RoleAccess.grantsError`, `ServerMeta.lifeCycleStatesAvailable`
- `src/shared/index.ts` — domain types only
- `src/client/components/RoleCard.tsx` — renders `grantsError`
- `src/client/App.tsx`, `src/client/styles/app.css` — degraded-catalog badge
- `scripts/smoke.ts` — six regression cases for findings 1-4 and the 404 path
- `.gitignore` — `commits/` removed
- `commits/feature_frontend-and-toolchain_09-10_1945.md`, `commits/feature_render-verification_09-10_1949.md` — previously skipped
