# review:round-two-client-and-residuals:09/11 09:42

## What I did
Second review round. The reviewer verified all eight round-one fixes with its
own probes — including a randomized sweep of 4,000 catalogs against the
attribution fix (5,104 object-type rows compared, 0 summary/detail mismatches,
0 invariant breaks) — then found one residual gap and reviewed the client for
the first time. Verdict was FIX FIRST on the client. All findings applied.

**Residual on the round-one fix (LOW, real).** The inverted owner index was
built by appending while iterating the raw object-type array, so a duplicated
object type id upstream would credit a grant twice and render
"full, 2/1 lifecycles, 8/4 states" — granted exceeding total, and the two views
disagreeing again, which is the exact class of bug the merged-binding design
exists to prevent. Now driven off the de-duplicated `objectTypeById` map.
Regression test added.

**C1 (MED) — the "no lifecycle states" alarm was invisible.** The client half of
round one's finding #4 did not land, for two independent reasons: the caveat was
only rendered after clicking "Caveats", and the header chip read
`meta.lifeCycleStatesAvailable`, which is `null` on first paint and stale by one
interaction afterwards (meta was refetched on group change, racing the matrix
load — a race that the in-process mock wins but a live upstream would lose).
Severity now travels as a structured `statesAvailable` field on
`DerivationNote` instead of a string the client has to sniff, and renders as an
unconditional warning. Meta is refetched after the matrix settles, and the
degraded signal comes from the matrix payload — one source, not two.

**C2 (MED-LOW) — side effect inside a state updater.** `toggleRole` called
`setSelection` from inside the `setExpandedRoleIds` updater. Not currently
misbehaving (the inner update happens to be idempotent, so React 19's
double-invocation converges) but it is a hazard the moment someone makes it
non-idempotent. The dependent update is now issued alongside the updater.

**C3 (LOW-MED) — the checks did not cover the component that matters.**
`renderToString` never runs effects, so `ObjectTypeDetail` only ever rendered
"Loading permissions…" — the per-state track and the Granted/Not-granted rows,
the entire point of the product, were never rendered by any check. Split a
presentational `ObjectTypeDetailView` out of the fetching wrapper and rendered
it against a real payload: 9 new assertions covering both lifecycles, all eight
states, reachable vs. unreachable marking, and the tally. Also fixed a
mislabeled assertion that claimed to check the monogram colour but only checked
the monogram text (the colour was rendered correctly; the label lied).

**C4 (LOW) — drill-down refetched on every reopen.** Zero upstream cost, but a
round trip and a loading flash over unchanged data. Memoised per
`roleId:objectTypeId` for the life of the page.

**C5 (LOW) — an eslint suppression with no eslint installed.** `useAsync` carried
`// eslint-disable-next-line react-hooks/exhaustive-deps` while nothing in the
project runs eslint. The reviewer audited all four call sites and found no
stale-closure bug today. Rather than pretend a tool enforces the contract, the
comment now states it plainly. Installing `eslint-plugin-react-hooks` is the
real fix and needs your approval first.

**Round-one residue #7.** The barrel no longer leaked wire types, but
`tsconfig.client.json` still pulled `resolver-api.ts` into the client program,
so it stayed importable by path — and the barrel itself had become unused. The
wire DTOs now live at `src/server/types/resolver-api.ts` and the barrel is
deleted, making the boundary structural rather than conventional.

**Nits:** caveat list keyed by index rather than by its own text; upstream
`color` validated as hex before reaching a style attribute; `aria-controls` on
the object-type button; an explanation when the group picker is empty.

**Also added: `check:live-path`.** Everything else exercises the mock. This
stands up a fake Resolver upstream, boots the real server with
`DATA_SOURCE=live`, and asserts what only the live path can get wrong: the
`x-api-key` header on every request, envelope unwrapping, the call budget
(measured at 6 = 3 + 2 + 1), zero-cost drill-downs, per-role failure isolation
returning HTTP 200, and that failures are not cached. Dependency-free.

## Verification
`npm run check` green: typecheck (3 projects) + 36 data + 21 render + 9
live-path = **66 assertions**. `vite build` clean. Manually confirmed over HTTP
beyond the scripted checks: bad API key → 401 with the upstream path, unreachable
upstream → 502, `DATA_SOURCE=live` without credentials refuses to boot.

## Files changed
- `src/server/domain/catalogIndex.ts` — owner index built off the deduped map
- `src/server/domain/access.ts` — `statesAvailable` on the derivation note
- `src/shared/types/domain.ts` — `DerivationNote.statesAvailable`
- `src/server/types/resolver-api.ts` — moved from `src/shared/types/`
- `src/shared/index.ts` — deleted (unused, and it leaked wire types)
- `src/server/{domain/normalize,data/source,data/liveSource,data/mockSource,data/mock/fixtures,http/resolverClient}.ts` — import paths
- `src/client/components/ObjectTypeDetail.tsx` — view/fetcher split, memoised
- `src/client/components/DerivationNotice.tsx` — unconditional degraded warning
- `src/client/components/RoleCard.tsx` — `aria-controls`, hex validation
- `src/client/components/GroupPicker.tsx` — empty-state explanation
- `src/client/App.tsx` — pure updater, meta sequenced after the matrix
- `src/client/hooks/useAsync.ts` — honest contract comment
- `scripts/live-path-check.ts` — new, live-path integration check
- `scripts/smoke.ts` — duplicate-id regression; failure case uses `ResolverApiError`
- `scripts/render-check.tsx` — drill-down coverage, corrected colour assertion
- `package.json` — `check:live-path` wired into `check`
- `README.md` — checks, boundary, error contract
