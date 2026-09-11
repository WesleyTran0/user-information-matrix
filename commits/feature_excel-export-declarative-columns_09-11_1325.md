# feature:excel-export-declarative-columns:09/11 13:25

Adds the Excel export: a flat, denormalized sheet of one group's permission
matrix, one row per (group, role, object type, lifecycle, state).

## What was done

**The column mechanism is the deliverable.** Every column lives in a single
declarative array (`MATRIX_COLUMNS`) of `{ header, key, width, value }`
descriptors. The workbook writer and the row builder iterate that array and
know nothing about the domain, so adding a field from the domain model to the
sheet is one appended descriptor and nothing else.

The row type carries the **domain objects** of the join (`UserGroup`, `Role`,
`ObjectTypeAccessDetail`, `LifeCycleAccess`, `StateAccess`) rather than
pre-flattened scalars. That is what makes a new column a one-line change: the
value function projects straight out of the object it needs.

Specific decisions worth recording:

- **Three negative outcomes are kept strictly distinct** in `Reported Access`:
  `No access` (API reported level 0), `Not reported` (call succeeded, no row for
  that state) and `Permissions unavailable` (call failed; the message goes in
  the `Permissions Error` column). Writing an empty cell for all three would
  read as "no access everywhere", which is the worst mistake this export could
  make.
- **`Grant Overstates`** is a real boolean column, TRUE exactly where the role
  holds the lifecycle grant but the API reports no access in that state. It is
  `null`, never `false`, where nothing was reported -- "we did not check" is a
  different claim from "the grant is accurate", and a filter on FALSE must not
  pick up unverified rows.
- Data gaps are emitted as rows with a `Note`, not dropped: unattributable
  grants, roles that reach nothing, lifecycles with no states, and drill-downs
  that failed to fetch.
- Drill-downs are fetched through the existing `mapWithConcurrency` at the
  caller's `RESOLVER_MAX_CONCURRENCY`, because the (role, object type) pair
  count is bounded by R x T, not R + T.
- `exportGroupWorkbook` depends on a structural `MatrixExportSource`, not on
  `MatrixRepository`, so the check builds a real .xlsx with zero network.

## Call cost

No new endpoint. For R roles reaching T object types over P distinct
(role, object type) pairs: `5 + R + P + T` upstream calls cold, 0 warm.
Measured on the fixtures for group 280774: 16 calls (3 collection + 2 catalog +
3 roles + 5 pairs + 3 object types), and 0 on a warm re-export.

## Deliberately not built

The all-groups export (P grows with the whole org; that needs a job queue and a
progress channel, not a request handler), and any HTTP route or React button.
Both are documented extension points.

## Check status

`npm run check` was run at this point and passed all six suites, including the
new `check:export` (43 assertions). Two mutation tests were used to confirm the
new assertions are not vacuous: collapsing `No access` into `Not reported`
produced 4 failures, and neutering `Grant Overstates` produced 5. Both were
reverted and the suite re-verified green.

Note this commit predates the merge of `main`'s `review:reported-permissions-findings`,
which changes several types these columns read; the schema is updated in the
following commit.

## Files changed

Added:
- `src/server/export/types.ts` -- `MatrixExportRow` (the join tuple),
  `ExportColumn`, `ExportCellValue`
- `src/server/export/columns.ts` -- `MATRIX_COLUMNS`, the sole column definition
- `src/server/export/rows.ts` -- `buildMatrixRows`, bounded drill-down fan-out
- `src/server/export/workbook.ts` -- exceljs writer, header styling, autofilter,
  sheet-name sanitizing
- `src/server/export/index.ts` -- `exportGroupWorkbook`, `MatrixExportSource`
- `scripts/export-check.ts` -- 43 assertions against a written-and-reparsed file

Modified:
- `package.json` -- added `exceljs` (user-approved) and the `check:export`
  script, wired into `npm run check`
- `package-lock.json` -- exceljs and its transitive deps
- `README.md` -- an "Excel export" section, the export in the layout tree, and
  the checks list
