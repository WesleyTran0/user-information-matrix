# review:reported-permissions-findings:09/11 13:24

## What I did
Applied the senior review of `feature:reported-per-state-permissions`. Verdict
was FIX FIRST: the architecture held, but the "authoritative" half could drop
authoritative data and three paths presented missing data as fact. All twelve
findings addressed, each with a regression test.

**1 (HIGH) — the authoritative half silently discarded authoritative rows.**
`buildObjectTypeAccessDetail` only ever *pulled* from the reported rows per
catalog state and never checked that every returned row was consumed, while
`summarizePermissions` iterated the catalog rather than the response. A row
whose state id is not in the merged catalog was dropped, and `reported` was
computed from whether anything matched — so upstream could return
`permission: 2` and the UI would render "not reported" in every row with no
roll-up at all. This fires on exactly the condition the app's own caveat already
admits to (the two object-type pointers disagreeing). Now:
`normalizeStatePermissions` returns the row count and each row's claimed
lifecycle, `reported` is driven by `rowCount > 0`, and unplaceable rows are
counted in `unmatchedReportedRows` with their lifecycle ids named in a warning.

**2 (MED) — the drill-down spent 2 calls and 2 permanent cache slots on an
object type id that does not exist.** The role guard ran first, but object-type
existence was only checked via the builder's null return, *after* the fetches.
Directly contradicted its own docstring. Both existence checks now run before
anything is fetched, off already-cached data. Verified over HTTP: a bogus id
returns 404 with `cachedStatePermissionCount: 0`.

**3 (MED) — `unknown` was conflated with "no row returned", producing a false
statement on screen.** Five states reporting an unrecognised level rendered as
"0 read & write, 0 read only, 0 no access, 8 not reported" — five of those eight
*were* reported. `PermissionSummary` gained an `unknown` bucket, rendered
separately. Since the 0/1/2 decoding is inferred from one role on one object
type, this is the most likely path to fire on another deployment, and it now has
render coverage it previously lacked entirely.

**4 (MED) — the swallowed requirements failure was presented as fact.** A failed
`stateRequired` call left every "Requires to exit" cell rendering `—`, which is
byte-identical to a healthy response where nothing is required. The policy
(don't fail the page) was right; the presentation was not. `requirementsError`
now travels on the detail and those cells render "unknown".

**5 (MED) — only one direction of the contradiction was detected.** Both the row
flag and the warning tested `granted && level === 'none'`; nothing tested the
reverse. With upstream reporting write access on a lifecycle the role does not
hold, the UI rendered "Lifecycle not granted" directly above a table reading
"Read & write" on every row, unflagged — while the derivation note asserted the
grant is an upper bound *as fact*. Added `understatedStates`, a "grant
understates" row flag, and reworded the note to state the upper-bound relation
as the assumption it is. (Noted but not fixed: `buildRoleAccess` walks only
granted lifecycles, so a role whose *only* reported access comes from a
non-granted lifecycle still never appears in the role list. Flagged below.)

**6 (MED) — a transient failure was cached client-side for the life of the page.**
`detailCache` stored details carrying `permissionsError`, and nothing evicted,
so one 500 pinned that row to an error until a full reload. Now the cache write
is skipped when either error field is set; the server does not cache failures
either, so reopening retries.

**7 (MED) — `TtlCache` never evicted, and this feature gave it its first
quadratic key space.** Entries were pruned only on a `get` of the same key.
Role-keyed caches are bounded by #roles; `perm:${roleId}:${objectTypeId}` is
bounded by roles x object types — order 10,000 for this org, and finding #2 made
it caller-driven. Added a size cap that sweeps expired entries from the oldest
end first and only then evicts live ones. `meta()` now reports both new caches.

**8 (LOW) — the shared requirements cache was correct but untested.** It is the
load-bearing half of the drill-down budget claim. Now asserted in
`check:live-path`: a second role on the same object type costs 1 call, not 2.

**9 (LOW, was a suspicion) — duplicate rows per state were last-wins.** The
payload carries a `formId`, which hints rows may be keyed per (state, form). If
two ever arrive for one state, last-wins could silently *lose* write access.
Colliding rows are now merged to the most permissive level with the union of
capabilities and triggers, and the collapse is counted and disclosed.

**10 (LOW) — `normalizeStateRequirements` claimed a discriminator it did not
read.** The comment said `type` distinguishes the kinds; the code branched on
which id was populated, and an `else if` meant a row with both a field and a
role counted only as a field. Now counts each populated id independently, with a
comment that says what the code actually does and admits `type`'s value set is
undocumented.

**11 — test audit.** Fixed the assertion that passed on an `AccessCell` label
rather than the roll-up (now keyed on `detail__reported`), de-vacuumed the
`.every()` that would pass on a zero-state lifecycle, and added the missing
coverage: unrecognised level, `permissionsError` banner, `requirementsError`
column, zero-state lifecycle, unplaceable rows, understated access, duplicate
merging, the object-type guard, and the cache bound.

**12 — accessibility.** Each lifecycle table now has a `<caption>`, so several
tables are distinguishable to table navigation. Facts that existed only in
`title` attributes — trigger ids, the raw permission value, and the whole
explanation of "grant overstates" — are now in text or `aria-label`.

Also: the role-list chip read a bare "5/8 states" from grant-derived counts; it
now says "states granted" with a tooltip pointing at the drill-down, and
`overstatedCount` (recomputed four times per render) is gone in favour of the
server-side summary.

## Still open, deliberately
`buildRoleAccess` attributes object types only through *granted* lifecycles. If
a role's sole reported access to an object type comes via a lifecycle it does
not hold, that object type is absent from the role list entirely and the
drill-down is unreachable. Fixing it properly means driving the role's object
type list off reported permissions, which costs one call per (role, object type)
pair up front — a real budget change. Worth discussing before I build it.

## Verification
`npm run check` green: typecheck (3 projects) + 74 data + 37 render + 22
live-path + 7 dev-server = **140 assertions**, up from 105. `vite build` clean,
module graph clean. Confirmed over HTTP that a bogus object type is a 404 that
spends no calls.

## Files changed
- `src/shared/types/domain.ts` — `unknown`/`unmatched`/`duplicate`/`overstated`/
  `understated` on `PermissionSummary`; `requirementsError`; meta counters
- `src/server/http/cache.ts` — bounded with expiry-first eviction
- `src/server/domain/normalize.ts` — `NormalizedStatePermissions`, duplicate
  merging, honest requirement classification
- `src/server/domain/access.ts` — row/state reconciliation, both contradiction
  directions, reworded note
- `src/server/data/repository.ts` — object-type guard before fetching,
  requirements error surfaced, new cache counters
- `src/client/components/ObjectTypeDetail.tsx` — summary-driven roll-up, new
  warnings, no caching of failures
- `src/client/components/StatePermissionTable.tsx` — caption, understated flag,
  accessible detail, "unknown" requirements
- `src/client/components/RoleCard.tsx` — "states granted" label
- `src/client/styles/app.css` — contradiction row, visually-hidden, chip detail
- `scripts/smoke.ts`, `render-check.tsx`, `live-path-check.ts` — 35 new assertions
