# feature:matrix-column-set:09/14 13:33

## What I did
Cut the Permission Matrix sheet to the 16 columns you specified, left to right:

Group · Role · Object Type · Lifecycle · State · **Access** · Can Read ·
Can Edit · Can Create · Can Delete · Can Merge · Can Manage · Can Bulk Launch ·
# Triggers Granted · # Triggers Available · Triggers Granted

That drops 26 columns: the ids, monogram, ordinal, numeric level, the
grant-vs-reported trio, the requirement counts, the object-type roll-ups, the
error columns and Note.

**On your "if reported level means something" question — it does, so I kept it
as one word.** The booleans cannot express it. `Can Read = FALSE` is the same
cell whether the API said level 0, returned no row for that state, or the call
failed outright, and those are three different facts. The `Access` column
carries exactly one word for each: **edit**, **read**, **none**, **unreported**,
**unavailable**, **unknown**. Where nothing was reported the booleans are left
**blank rather than FALSE**, so filtering `Can Edit = FALSE` cannot silently
sweep up states nobody checked.

**Two judgement calls you should know about:**

1. You wrote "can manage role"; I labelled it **Can Manage**, applying your
   earlier correction that the flag grants managing the object type in that
   state rather than managing a role. One word from you and I'll change it back.
2. The columns you dropped included the only places the sheet recorded a failed
   call or a grant/report disagreement. Rather than lose those signals, the
   Summary sheet's **Issues** column now also names states where the API
   reports access outside the role's grant list. Failed permissions,
   requirements and workflow calls were already named there.

## Verified on live data
Downloaded through the UI's own path: 16 columns in the requested order.
`Open` reads `edit / true / true / … / 3 of 24` with the granted triggers
named; `Creation` reads `none / false / false / 0 of 11`.

## Rewrote the export check rather than patching it
66 assertions referenced removed columns, which is past the point where
surgical edits are safe, so the assertion half of `scripts/export-check.ts` is
new (the helpers are unchanged). It now pins the exact 16 headers as a literal
— deriving them from `MATRIX_COLUMNS` would pass however that array changed —
and covers the four-way Access distinction, blank-not-FALSE booleans, trigger
counts and names, the Summary and Members sheets, a role that reaches nothing,
all three degradation paths, the 19-call cold budget, and that a second export
is free. 45 assertions, down from 61 because the columns they tested are gone.

`npm run check` green: 74 data + 47 render + 24 live-path + 7 dev-server +
45 export.

## Files changed
- `src/server/export/columns.ts` — the 16 columns; `canAccess`/`capability`
  helpers; helpers for removed columns deleted
- `src/server/export/summary.ts` — Issues also names access outside the grant
- `scripts/export-check.ts` — assertions rewritten for the new column set
