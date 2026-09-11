# feature:export-schema-for-reported-permissions:09/11 14:08

Merges `main` at `e5dfeac review:reported-permissions-findings` and updates the
export schema to the types that review changed. The merge was clean; the
fixtures were untouched, so the hand-derived expected counts in the export check
all still held.

## What the review changed, and what the sheet now does about it

**A failed requirements call is no longer invisible.** `ObjectTypeAccessDetail`
gained `requirementsError`. The `Requires Fields` / `Requires Roles` /
`Requires Other` columns previously wrote a blank both when a state required
nothing and when the call failed. Now a number always means the endpoint
answered -- and `0` is a reported zero, not a blank -- while `'unknown'` means
the call failed. The message itself goes in a new `Requirements Error` column.

**An unrecognised access level is its own outcome.** `Reported Access` emits
`Unknown level (raw N)`, which is neither `No access` nor `Not reported`, and
carries the raw integer inline as well as in `Reported Level`. So the column now
has four distinct negative-ish values, none of them an empty cell.

**`Grant Understates` added**, the mirror of `Grant Overstates`: TRUE where the
API reports access in a state the lifecycle grant does not cover. Its predicate
deliberately matches `PermissionSummary.understatedStates` exactly -- including
treating an unrecognised level as access rather than as nothing -- so a
per-state filter and the object-type roll-up can never disagree. Like
`Grant Overstates` it is blank, never FALSE, where nothing was reported.

**The new `PermissionSummary` diagnostics are surfaced** as per-object-type
roll-up columns that repeat down each (role, object type) block, the same way
the coverage counts already did: `Overstated States`, `Understated States`,
`Unknown Level States`, `Unmatched Reported Rows`, `Unmatched Lifecycle Ids`,
`Duplicate Reported Rows`. `Unmatched Reported Rows` is the important one -- it
is the review's finding that reported rows could be dropped, and a non-zero
value there means the sheet understates real access and says so.

Every one of these was a new descriptor appended to `MATRIX_COLUMNS` plus, where
the logic needed a name, a small local value function in the same file. No
change to `rows.ts`, `workbook.ts` or `types.ts` was needed, which is the
indirection working as intended.

## Check status

`npm run check` passes all six suites. `check:export` is now 62 assertions,
`check:data` 74.

New assertions added for this commit's behaviour, each driven by an injected
stub source rather than by editing main's fixtures:

- `Grant Understates` TRUE via a reported row on a lifecycle the role was never
  granted, plus that the two directions are mutually exclusive on that row.
- a reported row whose state id is not in the catalog, asserting
  `Unmatched Reported Rows` is 1 and the lifecycle id is named.
- an access level of 7, asserting `Reported Access` is `Unknown level (raw 7)`,
  that it is neither `No access` nor `Not reported`, and that it does not count
  as an overstated grant.
- a failing requirements call, asserting all 31 state rows read `unknown` rather
  than 0 or blank and that the reported permissions are unaffected.

Two further mutation tests confirmed the new assertions bite: dropping the
`requirementsError` branch produced 2 failures, neutering `grantUnderstates`
produced 4. Both reverted and re-verified green.

## Files changed

Modified:
- `src/server/export/columns.ts` -- `grantUnderstates` and `requirementCell`
  helpers; `Grant Understates`, `Requirements Error` and the six data-quality
  roll-up descriptors; `Reported Access` reworded for the unknown-level case
- `scripts/export-check.ts` -- sections 6b and 6c (understated grants, unknown
  levels, unmatched rows, failed requirements) and roll-up assertions
- `README.md` -- the Excel export section now documents four distinct outcomes,
  both audit hooks and the roll-ups; refreshed assertion counts

Merged from `main` (not authored here): `src/shared/types/domain.ts`,
`src/server/domain/access.ts`, `src/server/domain/normalize.ts`,
`src/server/data/repository.ts`, `src/server/http/cache.ts`, the client
components and `scripts/{smoke,render-check,live-path-check}.ts`.
