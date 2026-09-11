# feature:named-triggers-and-can-column:09/11 14:49

## What I did
Three changes from your review of the live page.

**1. Removed "GRANT OVERSTATES".** You were right and my framing was wrong. A
workflow restricting most of its states to a few roles is how workflows work,
not a discrepancy — so flagging 19 of 25 states in red, plus a banner calling
the grant a contradiction, was inventing an anomaly out of normal
configuration. The row flag, the red row highlight and the banner are gone;
no-access states now render plainly.

I kept one quiet note, for the *opposite* case: when the API reports access in
a state whose lifecycle is not in the role's grant list, the role list may be
missing an object type entirely. That one has a real consequence, and it reads
as a muted sentence rather than an alarm.

**2. Triggers are names now, with the full set shown.** This needed the endpoint
you pointed me at — `/object/objectType/{id}/objectLifeCycle/state?deep=true`.
I had probed ~20 shapes and missed it because I was appending to
`.../stateRequired` rather than `.../state`. It carries three things nothing
else does: `states[]` each listing **every** trigger id on them, `triggers[]`
with the names, and `transitions[]` mapping a trigger to its destination state.

So each state now lists the triggers this role can fire, by name, with the ones
it cannot behind a "+N not granted" disclosure — real states carry up to 24
triggers, so showing all of them inline would have made the table unreadable.
Each chip also shows where firing it leads (`Cancel Action → Cancelled`), which
came free from `transitions`. Verified on live data: 100% of names resolve, and
every granted id is a subset of its state's list.

Two details worth noting. Several transitions can share one trigger *and* one
destination, which rendered as "Review / Review / Review / Review" — destinations
are deduped. And a granted trigger id that the workflow definition does not
list still gets a row (as `Trigger {id}`), because the role demonstrably holds
it; dropping it would understate access.

**3. Access level folded into "Can".** Read and edit are verbs alongside the
capability flags now, matching the product: Open reads `read, edit, manage`.
The separate "Reported Access" column is gone. `canManageRole` reads as
**manage** — as you said, it grants managing this object type in this state,
not managing the role. No-access and not-reported still read as distinct words
in that column, since the two are genuinely different facts.

## Call budget
The drill-down goes from 2 to **3 calls cold, 0 warm**. The new workflow call is
per *object type*, shared across every role, so it amortises the same way exit
requirements do — asserted in `check:live-path`: a second role on the same
object type costs 1 call, not 3. The one-group Excel export moves from
`5 + R + P + T` to `5 + R + P + 2T`.

## Verification
`check:data` 74, `check:render` 42, `check:live-path` 24, `check:dev-server` 7,
`check:export` 61 — all green, and `vite build` clean. New coverage: names
render instead of ids, the role's own are marked, non-granted ones are present
but not shown by default, a destination appears once rather than once per
transition, a state with no triggers for the role says so, and no-access states
are asserted **not** to carry a discrepancy flag.

I also aligned the fixtures: granted trigger ids are now a subset of the
workflow's ids, which is what the live API actually does — previously they were
unrelated numbers, so the fixtures could not have caught a bad join.

## Not done
The Excel export still writes trigger **ids**, not names, since you said you are
ignoring the sheet for now. Adding `Trigger Names` / `Available Triggers`
columns is one descriptor each in `src/server/export/columns.ts`.

## Files changed
- `src/server/types/resolver-api.ts` — `ApiWorkflowResponse` and friends
- `src/server/data/source.ts`, `liveSource.ts`, `mockSource.ts` — new endpoint
- `src/server/data/mock/fixtures.ts` — workflow fixture; granted ids aligned
- `src/server/domain/normalize.ts` — `normalizeWorkflowTriggers` (3-way join)
- `src/server/domain/access.ts` — `mergeStateTriggers`, granted marking
- `src/server/data/repository.ts` — workflow cache, `triggersError`
- `src/shared/types/domain.ts` — `StateTrigger`, `triggersError`, meta counter
- `src/client/components/StatePermissionTable.tsx` — Can column, trigger chips
- `src/client/components/ObjectTypeDetail.tsx` — banner removed, vocabulary
- `src/client/styles/app.css` — trigger chips; contradiction styling removed
- `scripts/{smoke,render-check,live-path-check,export-check}.ts` — updated
- `README.md`, `src/server/export/index.ts` — documented cost
