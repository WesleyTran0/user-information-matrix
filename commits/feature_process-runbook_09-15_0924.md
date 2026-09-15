# feature:process-runbook:09/15 09:24

## What I did
Wrote `process.md` — a manual runbook for building the master workbook by
hand, and gitignored it as you said.

It is written so you can follow it with curl and reproduce the same file:
every call in order, one sentence on why each is made, the joins spelled out,
and the cell-level rules.

Structure:
- **Part 0** — why it takes two granularities: grants are cheap and tell you
  *which* object types a role reaches; the per-(role, object type) call is the
  only source of *what it can do per state*. With the measured evidence that
  the grant is only an upper bound (no access in 19 of 25 states).
- **Part 1, plan phase (5 + R calls)** — the 5 shared calls, the object-type ↔
  lifecycle merge, then one grant call per distinct role. Ends by stating
  P and T so the remaining cost is known: **P + 2T + 1 = 2,417**.
- **Part 2, fetch phase** — form catalog once, two calls per object type, then
  the 2,044 per-pair calls. Includes the three-way trigger join and the
  `permission` 0/1/2 decoding.
- **Part 3** — building rows: the four-way Access distinction, blank-vs-FALSE,
  trigger marking, form resolution, duplicate-row merging.
- **Part 4** — the three sheets, with the full 19-column source table.

Gotchas written down rather than left to be rediscovered: two endpoints are
**not** `{data}`-enveloped; `?deep=true` is a no-op on `stateRequired` but
load-bearing on `state`; group names are not unique (28 collisions), so key by
id; destinations must be deduped; blank is not FALSE; Excel's row ceiling; and
the two bugs only the full-scale run exposed.

Checked the doc against the code rather than writing it from memory: every
endpoint it names matches `RESOLVER_ENDPOINTS`, and its 19-row column table
matches the 19 descriptors in `columns.ts`.

## Files changed
- `process.md` — new, gitignored
- `.gitignore` — ignores it
