# feature:form-per-state:09/15 09:23

## What I did
Added the "default form for this state for this role" to the web UI and to both
workbooks.

**The selection was already being fetched.** `formId` rides on every
role-permission row and was already normalized into `StatePermission.formId`
and sent to the client — it was simply never displayed. Resolving it to a name
needed exactly **one** new call: `/object/form` returns all 1,164 forms in one
enveloped response, cached org-wide, so it resolves every form id everywhere
rather than costing a lookup per row.

Verified against your example before building: role Team Lead on object type
Action reports `formId 4287273` for **Open** → *1.3 - Action - GRC - Team Lead*,
and `null` for **Draft** → *Default*. Both match what the UI shows you.

**Three states kept distinct**, because collapsing them would mislead:
- `formId` null → **Default** (a real selection, not missing data)
- `formId` set and in the catalog → the form's name
- `formId` set but absent from the catalog → `Form {id}`, with `formsError` on
  the detail when the catalog call itself failed, so "we could not look it up"
  never reads as "this state uses the default"

**Where it shows.** A **Form** column in the drill-down table, and a **Form**
column in the matrix sheet — appended last so the left-to-right order you
specified is untouched. Both workbooks share `MATRIX_COLUMNS`, so the
individual and master exports picked it up from the one descriptor.

## Not done, per your call
"Default" is shown as-is. You confirmed the Resolver UI does not reveal what
the default resolves to, and nothing in the form records marks one — I checked
all 43 fields across all 1,164 forms, and object type Action has 25 forms with
none flagged. So `{form} (default)` stays out until there is a source for it.

## Cost
Group view unchanged at 5 calls. The drill-down goes 3 → **4 cold, 0 warm**, and
the 4th is the org-wide form catalog fetched **once per cache window**, not per
pair — asserted in `check:live-path`. The master export moves to
`5 + R + P + 2T + 1`; the plan phase's estimate was corrected to match, which
the export check verifies by comparing predicted against actually spent.

## Checks
`npm run check` green across all five suites. New coverage: the pinned-name,
default, and unresolvable-id paths in both the table and the sheet; the form
catalog being fetched exactly once; and a state with no reported permission
leaving the cell empty rather than saying Default.

## Files changed
- `src/server/types/resolver-api.ts` — `ApiForm`
- `src/server/data/source.ts`, `liveSource.ts`, `mockSource.ts` — `fetchForms`
- `src/server/data/mock/fixtures.ts` — forms, plus a deliberately unresolvable id
- `src/server/domain/normalize.ts` — `normalizeForms`
- `src/server/domain/access.ts` — resolves `StateAccess.form`
- `src/server/data/repository.ts` — form catalog cache, `formsError`, meta flag
- `src/shared/types/domain.ts` — `StateAccess.form`, `formsError`
- `src/client/components/StatePermissionTable.tsx` — Form column
- `src/client/components/ObjectTypeDetail.tsx` — catalog-failure notice
- `src/server/export/columns.ts` — Form column
- `src/server/export/allGroups.ts`, `index.ts`, `README.md` — corrected cost
- `scripts/{export-check,render-check,live-path-check,smoke}.ts` — coverage
