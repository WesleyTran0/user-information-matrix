# feature:bulk-permissions-and-relevance-filter:09/15 12:10

## What I did
Four changes, all driven by things you spotted.

**1. `Object Type Id` and `Lifecycle Id` columns.** Same reason as Group Id and
Role Id: object type and lifecycle names collide, so analysing the sheet by
name merges unrelated things. My own analysis of your "unreported" question was
wrong for exactly this reason — I keyed on names, got "402 mixed groupings",
and the real number was almost zero. 21 columns now.

**2. The master export uses one bulk call instead of 2,044.**
`/data/rolePermissions` with no parameters returns every permission row in the
org — 13,166 rows, 7 MB, ~10s. Verified it is not a lossy summary: for a
sampled pair its rows are identical to the per-pair endpoint down to trigger
ids, `formId` and every flag. It primes the existing per-pair cache, so the
drill-down code path is untouched; a pair absent from the bulk response falls
back to its own call rather than being assumed empty.

Result: **2,627 → 584 calls, 65.3s → 21.7s.**

**3. Lifecycles a role has no permissions in are dropped** — your first
example. An object type commonly owns lifecycles from unrelated processes, and
those rows read "unreported" in every column. **91,339 rows across 15,851
lifecycles** removed on a full export, disclosed on the Overview sheet rather
than silently.

My first cut of this had a real flaw, which the tests caught: it dropped rows
whenever every state was unreported, *including when the permissions call had
failed* — turning an outage into a confident "not relevant". It now only drops
when the call succeeded. A second flaw the tests caught: a role whose every
lifecycle was dropped vanished from the Summary sheet; it now appears as
"(no states this role has permissions in)".

**4. A missing row inside a lifecycle the role *does* use now reads `none`,
not `unreported`** — your second example, and you asked me to decide whether
it was the API or my logic. **It is the API.** For object type 442993 the
catalog and the workflow endpoint both report 6 states and agree; the
permissions endpoint returns **5 rows with no extras**. `Archived` genuinely
has no row. Since Resolver's own UI lists it alongside the rest, an absent row
inside a used lifecycle means no access — so it reads `none` with the `Can`
cells FALSE, in both the sheet and the web UI. `unreported` no longer appears
in output at all.

## On memory, since you asked
No disk cache exists — the cache is an in-memory Map that dies with the
process. The file is **12.6 MB**. The script now reports **peak memory**
(3,752 MB), which is high only because exceljs materialises the whole workbook
before writing. With a third of the rows now dropped it fits under Node's ~4 GB
default, so I removed the 8 GB ceiling I had added. Past this row count the fix
is exceljs's streaming writer, not a bigger heap.

## Verified on live data
Full run: 207 groups, **196,860 rows, 584 calls, 21.7s, 12.6 MB**. Access is
now three meaningful values — read 91,430 · none 81,165 · edit 24,227 — and
**zero** `unreported`. Both of your examples re-exported and checked: the
irrelevant KIC lifecycles are gone, and `Archived` on Involved Item reads
`none / false / false`.

`npm run check` green across all five suites, including a new case that
reproduces the 442993 gap by withholding one row from an otherwise complete
set.

## Files changed
- `src/server/export/columns.ts` — the two id columns; the used-lifecycle rule
- `src/server/export/rows.ts` — relevance filter, returns drop counts
- `src/server/export/allGroups.ts` — bulk priming, Overview disclosure
- `src/server/export/index.ts`, `summary.ts` — new row shape, role fallback
- `src/server/data/{source,liveSource,mockSource}.ts` — `fetchAllRolePermissions`
- `src/server/data/repository.ts` — `primeRolePermissionsFromBulk`
- `src/client/components/StatePermissionTable.tsx` — UI matches the sheet
- `scripts/export-all-groups.ts` — peak memory, heap flag removed
- `scripts/{export-check,smoke}.ts` — new coverage
- `process.md`, `README.md` — rewritten for the new flow and costs
