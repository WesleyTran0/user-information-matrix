# review:round-three-live-path-check:09/11 09:52

## What I did
Third review round. All six round-two fixes were confirmed by the reviewer's own
probes — including a hardened randomized sweep of **8,000 catalogs** (4,009 of
them containing duplicated object-type rows) over the attribution invariants:
10,243 rows compared, 0 summary/detail mismatches, 0 invariant breaks. The
client program was confirmed by `tsc --listFiles` to contain zero wire types.
The findings below are all against `scripts/live-path-check.ts`, the one file
that had never been reviewed.

**L1 (HIGH) — the check could pass while testing nothing.** This was the real
one, and it was mine. `server.listen(9900)` reports `EADDRINUSE`
asynchronously, so `startUpstream()` returned normally, the app child was
spawned, and the uncaught error then killed the parent *outside* the `try` —
so `finally` never ran and the child was never killed. The reviewer reproduced
the second-order effect, which is what makes this severe: on the next run,
`waitForServer` connected to the **orphan from the previous run**, and the
script printed all checks green while its own child had silently died
(`stdio: 'ignore'`). Every assertion was served by a stale process running
older code. Edit the server, run the check, get a green light on code that
never executed.

Fixed by removing fixed ports entirely rather than patching the symptom: the
fake upstream binds port 0 and reports what it got; the app child is spawned
with `PORT=0` and the script **parses the port out of that child's own stdout**,
so it cannot address a process it did not start; `startApp` rejects if the
child exits before listening; all children are tracked in a set and killed in
`finally`; stdout/stderr are captured and included in the failure message.
This required the server to report the port it actually bound (it was echoing
the configured value, which is `0` under an ephemeral port), and `env.ts` to
accept `PORT=0` as "let the OS choose".

Verified two ways: a run where the child cannot start now exits **1** with a
loud error and leaves no orphan, and a full `npm run check` leaves zero
listeners behind.

**L2 (MED) — the header claimed coverage that did not exist.** It advertised
"upstream error mapping" while the only status assertion was `200`. Now real:
an upstream 500 on `/user/group` must surface as **502** with the upstream path
named, and a rejected API key must pass **401** through. Both use a fresh child
rather than the dev-only `POST /api/cache/clear`, which also settles **L5** —
the check no longer depends on an endpoint that is gated off in production.

**L3 (MED) — the budget check could not detect the regressions that matter.**
With one group and one role, a naive implementation that refetched per group
would still have scored 6. The fixture now has two groups **sharing role 77**,
and both group requests are issued **concurrently** — so "a role in two groups
is fetched once, even concurrently" is now asserted directly, covering both
cross-group de-duplication and the single-flight cache.

**L4 (LOW)** — `seen.every(...)` is vacuously true on an empty array; it is now
paired with `seen.length > 0`.

**Round-three caveats on the C4 cache**, both accepted: the comment claiming
"the server's TTL governs real staleness" was wrong — the client never re-asks,
so its copy outlives the server TTL and ignores a server-side cache clear. The
comment now says that plainly. The reviewer also noted `cached` is not in the
hook's deps despite deciding whether `load` is null, which the contract written
in the same commit demands; it is safe here because the transition only ever
goes undefined→defined for a key, and that reasoning is now written down.

Also removed the `.chip--warn` CSS rule, dead since round two replaced the
header chip with an unconditional warning.

## Verification
`npm run check` green: typecheck (3 projects) + 36 data + 21 render + **15**
live-path = **72 assertions**. No orphan processes or listeners after a full
run, and a failed run exits non-zero with no leak.

## Files changed
- `scripts/live-path-check.ts` — rewritten: ephemeral ports both sides, port
  parsed from the child's own output, tracked children, error-mapping and
  shared-role/single-flight coverage
- `src/server/index.ts` — reports the port actually bound
- `src/server/env.ts` — `PORT=0` allowed, meaning ephemeral
- `.env.example` — documents it
- `src/client/components/ObjectTypeDetail.tsx` — corrected cache staleness
  comment, documented the deps decision
- `src/client/styles/app.css` — dropped dead `.chip--warn`
- `README.md` — assertion counts
