# review:org-scale-export-fixes:09/14 13:54

## What I did
Ran the master export for real against all 207 groups, which broke it, and
fixed what broke.

**The bug: `rows.push(...groupRows)` overflowed the call stack.** Spreading an
array passes every element as a separate argument, and at org scale one group
exceeds the argument limit:

    RangeError: Maximum call stack size exceeded
        at exportAllGroupsWorkbook (allGroups.ts:182)

My `--limit 5` trial produced 1,784 rows and never came close. The real run
produces **288,199**. Replaced with an `appendAll` loop carrying a comment
saying why it must not go back to a spread. I confirmed the failure mode rather
than assuming it: a spread of 300,000 elements throws, the loop does not.

**A second scale problem the first one implied.** If one group can produce six
figures of rows, the combined sheet can approach **Excel's hard limit of
1,048,576**. Writing past it yields a file Excel refuses to open, which is
worse than failing. `assertFitsInSheet` now throws naming the actual count,
the limit, and the way out (`--groups` / `--limit`). Today's run is at 27% of
that ceiling, so it is not hypothetical for a larger tenant.

## The full run
    207 groups, 205 roles, 186 object types, 2,044 pairs
    288,199 permission rows, 2,626 upstream calls, 41.2s, 12.9 MB
    exports/all-groups-2026-09-14.xlsx

## A finding worth acting on: group names are not unique
Reconciling the sheets turned up that the Permissions sheet holds **173**
distinct group names against 207 groups. That is fully explained, and not a
bug in the export:

  - **6** groups have zero roles, so they have nothing to report. They appear
    on the User Groups sheet and legitimately not on Permissions.
  - **28** group names are shared by two different groups each — e.g.
    "a regional process-owner group" is both id 100001 and id 100002.

179 distinct names, minus the 6 with no roles, is exactly 173.

The consequence matters: the Permissions sheet identifies a group **only by
name**, because the agreed 16 columns exclude Group Id. So filtering that sheet
by name silently merges two different groups for 28 of the 207. I have not
added the column, since the column set was specified deliberately — flagging it
for a decision instead.

## Checks
`npm run check` green. New export coverage asserts the spread genuinely
overflows at that size (so the fix is not guarding a phantom), that
`appendAll` handles 300k preserving order, and that the row guard passes at
the limit minus one and fails at the limit with a message naming the way out.

## Files changed
- `src/server/export/allGroups.ts` — `appendAll`, `assertFitsInSheet`
- `scripts/export-check.ts` — scale regressions
