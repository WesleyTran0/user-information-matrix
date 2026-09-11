# review:redact-identities-before-publish:09/11 11:09

## What I did
Sanitized the repository ahead of publishing it to a **public** GitHub repo,
then documented the redaction.

**What was exposed.** The fixtures and `CLAUDE.md` carried six email addresses.
Three were real people copied verbatim from the sample payloads
(two on the corporate domain, one at a vendor); the other three were
names I invented but had attached to the live corporate domain, which makes
them look real. `CLAUDE.md` also carried the org id in eleven places.

**What I changed.** Personal names and addresses are now obviously fictional
(Ada Lovelace, Grace Hopper, Alan Turing, Jean Bartik, Katherine Johnson,
Grete Hermann, all @example.com) and the org id is a placeholder. Nothing
structural moved: ids, `externalRefId`s, lifecycle/object-type relationships,
the `~RESOLVER_` account-name convention and every case the fixtures were
built to exercise are unchanged, so the derivation and all its tests behave
identically.

**History was rewritten, not just the tip.** The real data was present in all
seven commits, so a tip-only fix would have left it one `git log -p` away.
`git filter-branch` applied the redaction to every commit, then
`refs/original`, the reflog and unreachable objects were purged and the object
store re-packed. The seven commits keep their original messages and structure.
A pre-rewrite bundle is in this session's scratchpad, outside the repo.

**A note on how this nearly went wrong.** My first pass keyed on JSON
double-quoted values, which cleaned `CLAUDE.md` but missed `fixtures.ts`,
where TypeScript uses single quotes — the names survived in the rewritten
history. Re-running quote-agnostically fixed it. The verification that caught
this is a scan of *every commit reachable from main*, not just the working
tree, and that scan is now clean.

## Verification
- `git grep` for every redacted string across all commits on `main`: no matches.
- Same scan across the entire object store after `gc --prune=now`: no matches.
- `npm run check` green after the rename — 36 data + 21 render + 15 live-path +
  7 dev-server, plus typecheck. The name change flows through the assertions in
  `render-check.tsx`, which is why they had to be rewritten in lockstep.

## Files changed
- `src/server/data/mock/fixtures.ts` — fictional identities, provenance comment
- `CLAUDE.md` — fictional identities, placeholder org id, redaction note
- `scripts/render-check.tsx` — assertions follow the renamed fixtures
- (history) all seven prior commits rewritten with the same redaction
