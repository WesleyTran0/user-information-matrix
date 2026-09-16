# feature:claude-md-handoff:09/16 10:04

## What I did
Appended a "Project state (handoff)" section to CLAUDE.md so the next session
starts informed rather than rediscovering things. The original spec above it is
untouched.

Contents:
- **What exists** — web UI, per-group export, master export, and `process.md`,
  with the commands for each and where the code lives.
- **Endpoints beyond the original spec** — the five discovered during this
  session, including `/data/rolePermissions` with no parameters.
- **Semantics that are easy to get wrong** — the 0/1/2 decoding, what
  `canManageRole` actually grants, `formId: null` meaning Default, the
  drop-irrelevant-lifecycles rule and its failure caveat, missing-row-means-
  `none`, blank-is-not-FALSE, names not being unique, the two unenveloped
  endpoints, and that there is no "ALL STATES" row to go looking for.
- **Export shape** — the 21 columns in order and the one-word `Access` values.
- **Measured cost** — 584 calls, ~22s, 196,860 rows, 12.6 MB, 3,752 MB peak,
  plus the note that exceljs streaming is the next step if rows grow.
- **Working practices** — targeted check suites while iterating, the reviewer
  agent before each `review:` commit, what is gitignored, that the repo is
  public, and the environment quirks (zsh word-splitting, no `lsof`).
- **Open questions for the Excel work** — five undecided seams, since that is
  what you said the next session is for: styling, the missing cross-group
  roll-up, blank-`State` rows losing their `note`, `# Triggers Available`
  reading oddly, and the fact that both workbooks share one column array.

Checked before committing that no live group names, role names or tenant ids
went in, since this file is committed to a public repo.

## Files changed
- `CLAUDE.md` — new handoff section (354 → 485 lines)
