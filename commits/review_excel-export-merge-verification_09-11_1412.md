# review:excel-export-merge-verification:09/11 14:12

## What I did
Merged the delegated Excel-export work into `main` and verified it myself
rather than taking the agent's report at face value.

**Merged** `worktree-agent-afa643adc473a8cd0` (two `feature:` commits, each with
its own `commits/` changelog) as a no-ff merge. It had already merged `main`
twice, so it built against the reported-permissions schema *and* the review
fixes on top of it — its `Requires *` columns distinguish a failed requirements
call from "nothing required", which was one of the conflations the review made
me fix in the UI.

**Security: `exceljs` arrived with a vulnerable `uuid`** (<11.1.1, GHSA-w5hq-g745-h8pq).
`npm audit fix --force` wanted to solve it by downgrading exceljs from 4.4.0 to
**3.4.0**, which is not acceptable. Pinned the existing transitive `uuid` forward
to ^11.1.1 via `overrides` instead — no new dependency, and the same approach
already used for `qs`. Now **0 vulnerabilities**, exceljs 4.4.0 on uuid 11.1.1,
and `check:export` re-verified green afterwards so the bump is known not to
break workbook writing.

**Independent verification.** The agent's own check reads the file it just
wrote, so I generated a workbook separately, reparsed it with exceljs, and read
the cells as a user would. Confirmed: sheet named after the group
("Incident Supervisor"), **39 columns**, 33 data rows, frozen header row,
autofilter over `A1:AM34`. The rows say the right things — Triage reports
`No access` with `Grant Covers State = true` and `Grant Overstates = TRUE`,
while Open reports `Read & write`, level 2, `Can Create`, 2 triggers.

The `Grant Overstates` / `Grant Understates` pair is the point of the whole
export: one filter over those two columns surfaces every grant in the org that
is wrong in either direction. Against live data, one role showed 19 overstated
states on a single object type.

Worth noting what the cells do for a state with no reported row: the boolean and
capability columns are left **blank rather than FALSE**, so "not reported" stays
distinguishable from "reported as false". That three-way distinction survived
into the spreadsheet, which is the thing I was most worried about losing.

## Cost, measured
`5 + R + P + T` cold (R roles, P distinct role/object-type pairs, T object
types), 0 warm. 16 calls on the fixtures. For the live *a 9-role group*
group (9 roles, 41 object types, ~350 pairs) that is roughly **405 calls** — which
is why the all-groups export stayed out of scope and the fan-out goes through
`mapWithConcurrency`.

## Caveats the agent raised, which I agree with
1. `PermissionSummary` lives on the *detail*, not on `ObjectTypeAccess`, so the
   roll-up diagnostics are only reachable after paying for the drill-down —
   they cannot be used to decide *whether* to drill down.
2. `normalizeStateRequirements` still overloads absence: "requires nothing" and
   "state absent from the payload" are both `null`. The export writes `0` when
   the call succeeded, which is an export-layer decision, not a domain one.
3. `unresolvedLifeCycleIds` carries ids with no names, so those rows show a bare
   number in `Note`.

## Verification
`npm run check` green across all six suites on `main`: typecheck + 74 data +
37 render + 22 live-path + 7 dev-server + **62 export** = **202 assertions**.
`npm audit` clean. No `.env` access and no live calls anywhere in the export
path — it runs off `MockResolverSource` in the checks and takes its data source
by injection.

## Files changed
- (merge) `src/server/export/{types,columns,rows,workbook,index}.ts` — new
- (merge) `scripts/export-check.ts`, `package.json` (`check:export`), `README.md`
- `package.json`, `package-lock.json` — `uuid` override pinning out the CVE
