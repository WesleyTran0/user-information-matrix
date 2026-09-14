# feature:master-all-groups-export:09/14 13:50

## What I did
Removed the Members sheet, and added `npm run export:all` — the master
workbook covering every user group.

**Master workbook, three sheets as specified:**
1. **Overview** — the export timestamp (ISO and local), headline counts, and a
   line describing each other sheet and what it is for. Plus the one caveat
   that matters when reading the data: a blank `Can` cell means nothing was
   reported for that state, which is not the same as FALSE.
2. **User Groups** — Group, Group Id, Description, # Members, # Roles,
   # Object Types Reachable, filterable and frozen.
3. **Permissions** — the same 16 columns as the single-group export, spanning
   every group.

**Why it is a script, not a route.** Cost scales with the org: one call per
distinct (role, object type) pair. Measured against your live tenant just now:
**207 groups, 205 distinct roles, 186 object types, 2,044 pairs** — 210 calls to
plan and about 2,400 to fetch. That is a job, not a request handler.

So it runs in two phases and reports the cost *between* them. The plan phase
spends only the cheap shared calls and can then state P exactly;
`--dry-run` stops there, which answers "what would this cost?" for the price
of the cheap calls alone. `--limit N` and `--groups 1,2,3` allow a trial run,
`--out` sets the path. Progress is a single rewritten line on a TTY and every
tenth group when piped to a file.

**A failing group does not sink the export.** Its matrix error is caught, the
remaining groups still export, and the skipped groups are named with their
reason on the Overview sheet — an org-wide export that dies on group 140 of 207
would waste everything before it.

## Verified against live data
`--dry-run`: the numbers above. `--limit 5`: 1,784 permission rows across 5
groups, 396 upstream calls, 3.4s, three sheets in the right order. Reparsed the
file and read the cells: Overview describes each sheet and carries both
timestamps; User Groups shows e.g. *a 288-member group — 288 members, 8 roles,
42 object types*; Permissions has 16 columns spanning all 5 groups.

## Checks
`npm run check` green: 74 data + 47 render + 24 live-path + 7 dev-server +
**62 export** = 214 assertions. New export coverage: the three sheets in order,
the plan spending no per-pair call, the fetch phase spending exactly what the
plan predicted, the overview describing every sheet, group stats agreeing with
the matrix, the permissions sheet spanning all groups with the same columns,
and a skipped group being recorded rather than swallowed.

## Note
`planAllGroupsExport` runs twice when the CLI reports cost and then exports.
The second run is served from cache so it costs no upstream calls, but it does
re-walk the group matrices. Worth passing the plan through if that ever shows
up in a profile.

## Files changed
- `src/server/export/allGroups.ts` — new: plan/fetch phases, all three sheets
- `scripts/export-all-groups.ts` — new: the CLI, flags, progress
- `src/server/export/summary.ts`, `index.ts` — Members sheet removed
- `package.json` — `export:all`; `.gitignore` — `exports/`
- `scripts/export-check.ts` — master-export assertions; Members ones removed
- `README.md` — documents both exports and the measured cost
