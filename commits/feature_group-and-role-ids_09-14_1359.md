# feature:group-and-role-ids:09/14 13:59

## What I did
Added `Group Id` and `Role Id` back to the Permissions sheet, each next to
the name it disambiguates, and used them to correct an analysis I had got
wrong.

Columns are now 18: Group · **Group Id** · Role · **Role Id** · Object Type ·
Lifecycle · State · Access · the seven Can columns · the three trigger columns.
`Group Id` carries a comment recording *why* it exists — 28 of the 207 groups
share a name with another group — so it does not get trimmed again as
redundant.

**They immediately paid for themselves.** I had reported that only 6 groups
were absent from the Permissions sheet, all with zero roles. That was wrong,
and wrong in the way the duplicate names cause: I matched groups by *name*, so
28 zero-role groups looked present because their same-named twin had rows.
Re-checked by id:

    207 groups on User Groups
    173 present on Permissions
     34 absent -- every one of them with zero roles
      0 absent with roles and reachable object types

So there is no data loss, which the name-based check could not have
established. The pattern also explains the odd pair from earlier: of
"a regional process-owner group" id 100001 and id 100002, the first has 57 rows
and the second has none, because the second has no roles.

**The Overview sheet now states that reconciliation.** 207 groups against 173
on Permissions reads as missing data until you know why, so the sheet says how
many groups have no roles, that they are listed on User Groups, and how many
appear on Permissions.

## Verified
Regenerated against live: 288,199 rows, 2,626 calls, 40.3s, 14.9 MB.
Distinct group ids on Permissions: 173, matching the 173 groups that have
roles. `npm run check` green — 74 data + 47 render + 24 live-path +
7 dev-server + **70 export** = 222 assertions, including one that every row
carries both ids and one that the reconciliation line appears only when a
group actually has no roles.

## Files changed
- `src/server/export/columns.ts` — Group Id and Role Id
- `src/server/export/allGroups.ts` — Overview reconciliation line
- `scripts/export-check.ts` — assertions for both
