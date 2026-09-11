# feature:render-verification:09/10 19:49

## What I did
Added a render smoke test and consolidated the project's checks behind
`npm run check`.

**Why a render test.** `vite build` proves the code compiles and bundles; it
does not prove the component tree actually renders. Neither browser option was
available without a new dependency (`chromium-cli` is not installed, the Chrome
integration is not exposed here, and Playwright would need approval), so
`scripts/render-check.tsx` renders the real components to a string in Node,
driving them with real derived data from the mock repository. It asserts the
things that actually matter in the output: coverage badges, granted/total state
counts, the selected drill-down row, group members with their status chips,
the on-screen derivation label, and that unattributable lifecycle grants are
surfaced rather than dropped. 12 assertions, all passing.

One assertion failed on the first run and it was the assertion's fault, not the
app's: React's SSR output separates adjacent text nodes with `<!-- -->`, so
`5/8` arrives as `5<!-- -->/<!-- -->8`. The helper now strips those markers.

**Checks are now one command.** `npm run check` = `typecheck` (tsc -b across
client, server and a new scripts project) + `check:data` (20 assertions) +
`check:render` (12 assertions). All green.

Two wrinkles worth recording: the SSR build needs `target: 'node22'` because the
entry uses top-level await, which Vite's default browser target rejects; and the
scripts project must `include` the `src` trees it imports, because a composite
TypeScript project has to list every file it pulls in.

## Files changed
- `scripts/render-check.tsx` — new: renders real components with real data
- `vite.render-check.config.ts` — new: Node-targeted SSR build for that entry
- `tsconfig.scripts.json` — new: third project, covers scripts + vite configs
- `tsconfig.json` — references the scripts project
- `package.json` — `check`, `check:data`, `check:render`; `typecheck` now `tsc -b`
- `README.md` — documents the check commands
