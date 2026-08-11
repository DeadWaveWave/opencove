# Re-review (round 2)

> Round-1 record (superseded REJECT): [`TERMINAL_P0_ACCEPTANCE.md`](./TERMINAL_P0_ACCEPTANCE.md)


**VERDICT: ACCEPT-WITH-FOLLOWUPS**

The round-1 P0 is genuinely fixed, and fixed the right way. I re-ran every gate myself, and I
adversarially tried to break each claim rather than reading the diff and agreeing with it. Nothing
blocking survived. Two follow-ups below are real but neither is a correctness defect on the platform
this code will ship to first, and neither is a regression against `origin/main`.

- Reviewer: same independent acceptance gate as round 1 (not the implementer)
- Worktree: `/Users/shihaojie/orca/workspaces/opencove/terminal-stability`
- **Remediation is STAGED, NOT COMMITTED.** `HEAD` is still `713db510`; the round-2 work is 33 staged
  files (`git diff --cached`). All findings below refer to the staged tree, which is also the working
  tree (`git diff --name-only` is empty \u2014 index and worktree agree).
- Baseline: `origin/main` = `f36a1d48`

---

## 1. Round-1 findings \u2014 status

| # | Round-1 finding | Status | Evidence |
| --- | --- | --- | --- |
| **P0-1** | Red remote-recovery tests | **FIXED** | `tests/unit/app/sessionPrepareOrReviveHandler.remoteRecovery.spec.ts:5,81,122` \u2014 3 added lines total. See \u00a72. |
| **P1-1** | `failStartup()` permanently terminal | **FIXED** | `TerminalRuntimeAvailability.ts:83` \u2014 one-line gate change + new test `tests/unit/terminalRecovery/TerminalRuntimeAvailability.spec.ts:71-92`. See \u00a75. |
| **P1-2** | Ambiguous host exit permanently bricks supervisor | **FIXED** | New `src/platform/process/ptyHost/ambiguousExitRecovery.ts`; wired at `supervisor.ts:178-193,237,455`. See \u00a75. |
| **P1-3** | Host echoes the request as the ACK | **FIXED (POSIX) / FIXED-BY-DESIGN (Windows)** | `entry.ts:317,322` now sends `resizePtyAndReadAck(...)`. Residual nuance in \u00a76 (NEW-1). |
| **P1-4** | Remote `accepted && geometry == null` echoes the request | **FIXED** | `ptyStreamHub.resize.ts:343`; `remotePtyStreamMessageHandler.ts:123-124`; `BrowserPtyGeometryAckCoordinator.ts:71-72`. Falsified in \u00a74. |
| **P1-5** | `supervisor.resize` falls back to the request | **FIXED** | `supervisor.ts:418` returns `parsePtyHostResizeResult(...)`, which **throws** on a malformed/absent ack (`resizeAck.ts:41-57`). The `?? cols` fallback is gone. |
| **P2-1** | Prettier violation in T1's test file | **FIXED** | `format-check:staged` passed inside `pnpm pre-commit` with a non-empty staged set (\u00a73). |
| **P2-2** | Three files at 499/499/498 lines | **DECLINED \u2014 legitimately** | See \u00a77. |

**Round-2 counts: P0 = 0, P1 = 0, P2 = 2 (both new, both non-blocking).**

---

## 2. Were the original test assertions preserved, or weakened?

**PRESERVED. Verbatim. This is the single most important question in this re-review and the answer
is unambiguous.**

`git diff origin/main -- tests/unit/app/sessionPrepareOrReviveHandler.remoteRecovery.spec.ts` is
**+3 lines, -0 lines**, across the whole branch (not just round 2):

```diff
+import { createReadyTerminalAdmissionDeps } from '../contexts/controlSurfaceTestTerminalAvailability'
   registerSessionPrepareOrReviveHandler(controlSurface, {
+      ...createReadyTerminalAdmissionDeps(),          // test 1, spec:81
   registerSessionPrepareOrReviveHandler(controlSurface, {
+      ...createReadyTerminalAdmissionDeps(),          // test 2, spec:122
```

There is **no `-` line anywhere in that file's diff**. Every `expect` \u2014 including the two that were
red (`expect(result.ok).toBe(true)` and the "must not spawn a replacement" call-count assertion) \u2014
is byte-identical to `origin/main`. The fix is exactly the dependency injection I prescribed, using
the pre-existing helper I pointed at. Nothing was deleted, skipped, loosened, `.skip`ped, or
converted to a weaker matcher.

I also checked the *other* touched specs for smuggled weakening. The only edits in
`ptyHostSupervisor.spec.ts` / `.spawnIdentity.spec.ts` are `protocolVersion: 2 \u2192 3` (forced by the
protocol bump at `protocol.ts:1`) plus **two net-new tests**. The one renamed test,
`'fails closed when transport loss leaves the prior host exit unconfirmed'` \u2192
`'fails closed until a bounded escalation retires an unconfirmed host'`, **keeps its original
fail-closed assertions** (`spawnIdentity.spec.ts:100-107`: still asserts the immediate rejection and
`createProcess` called exactly once) and *appends* the recovery assertions. That is strengthening,
not weakening.

The contract spec `tests/contract/ipc/ptyRuntimeGeometry.spec.ts` changed `100\u00d732 \u2192 91\u00d727` in the
third test. This **looks** like a moved goalpost, so I falsified it (\u00a74): the mock host now returns
91\u00d727 for a 100\u00d732 request, and the assertion demands 91\u00d727 be committed *and broadcast*. That is a
strictly stronger assertion than before, when the mock returned nothing and the test could not tell
request from ack.

---

## 3. Verification I personally re-ran

All commands run by me, in this worktree, on the staged tree. macOS.

| # | Command | Real observed result |
| --- | --- | --- |
| W1 | `pnpm test -- --run` | **PASS** \u2014 `Test Files 428 passed \| 4 skipped (432)`, `Tests 1694 passed \| 6 skipped (1700)`, `EXIT=0` |
| W2 | `pnpm pre-commit` | **PASS \u2014 `EXIT=0`** (14.2m e2e). Matches the implementer's claim. |
| W3 | \u21b3 `test:staged` inside W2 | **Genuinely ran this time**: `Test Files 183 passed \| 2 skipped (185)`, `Tests 601 passed \| 2 skipped (603)` |
| W4 | \u21b3 `test:terminal-recovery:native` inside W2 | **PASS** \u2014 `3 passed (3)` |
| W5 | \u21b3 `test:e2e:pre-commit` inside W2 | **PASS** \u2014 `261 passed, 48 skipped, 3 flaky`, exit 0 |
| W6 | `git diff --cached --name-only \| wc -l` | **33** \u2014 matches the claimed staged set exactly |
| W7 | `pnpm arch:check` | **PASS** \u2014 `0 error(s), 0 warning(s), 1147 file(s)` |
| W8 | `pnpm arch:doc-sync` | **FAIL (exit 1)** \u2014 two causes, both analysed in \u00a76 (NEW-2); neither is in CI or `pre-commit` |
| W9 | Falsification harness (4 independent patch-and-run experiments) | **All 4 red pre-fix** \u2014 \u00a74 |
| W10 | `terminal-resize-shrink` \u00d7 4 isolated runs, pre-fix vs post-fix | **Pre-existing flake, not branch-caused** \u2014 \u00a74 |

**The implementer's numbers are accurate.** 428/1694 and `pre-commit` exit 0 both reproduce exactly,
and the staged count is 33. This is a marked contrast with round 1, where the claim was false.

Critically, **the staged gates were no longer vacuous.** Round 1's `pre-commit` was green only
because `git diff --cached` was empty and every `*:staged` script exits 0 on an empty set. With 33
files staged, `test:staged` actually executed 601 tests (W3) and `format-check:staged` actually
inspected the file it silently skipped in round 1.

### The 3 flaky e2e tests

`agent-status-watcher.spec.ts:185` and `selection.spaces.marquee-inside.spec.ts:12` are the same two
I already characterised in round 1 as flaky / pre-existing-on-main. The third,
`workspace-canvas.terminal-resize-shrink.spec.ts:202`, is **inside this change's blast radius**, so I
did not accept "flaky" on trust \u2014 see \u00a74.

---

## 4. Falsifiability \u2014 do the new tests actually fail against pre-fix code?

A test that cannot fail proves nothing. I reverted each production fix in isolation, ran the
corresponding spec, then restored the tree. **All four experiments went red.**

| Experiment | Patch applied | Result |
| --- | --- | --- |
| **F1** \u2014 host read-back | `resizeAck.ts` \u2192 `return { status:'applied_verified', cols, rows }` (round-1 echo behaviour) | `tests/unit/platform/ptyHostResizeAck.spec.ts`: **2 failed (2)**. Both the POSIX read-back case and the win32 case fail. |
| **F2** \u2014 the "requested 120\u00d740, host applies 91\u00d727" invariant | `localPtyGeometryCommit.ts:172` \u2192 `commitGeometry(normalizedInput)` (commit the request, as before) | `tests/contract/ipc/ptyRuntimeGeometry.spec.ts`: **1 failed \| 3 passed**. Exact diff: `- "cols": 91 / + "cols": 100`, `- "rows": 27 / + "rows": 32`. **The invariant genuinely fails pre-fix.** |
| **F3** \u2014 hub `??` fallback | `ptyStreamHub.resize.ts:343,354` \u2192 restored `runtimeResult?.geometry ?? plan.geometry` | `ptyStreamHub.resizeGeometryAck.spec.ts` + `remotePtyStreamMessageHandler.spec.ts`: **2 failed \| 8 passed** \u2014 `'does not commit a remote accepted result that omitted geometry'` and `'rejects a remote accepted result without geometry as runtime_failed'` |
| **F4** \u2014 remote parser | `remotePtyStreamMessageHandler.ts:123-124` \u2192 restored plain `status` / `changed` passthrough | (folded into F3 above; the parser test is the second failure) |

Tree restored and verified clean after every experiment (`git diff --name-only` empty).

### W10 detail \u2014 the `terminal-resize-shrink` flake is NOT branch-caused

This test failed once inside `pre-commit` (passed on retry #1). Because it is the flagship geometry
e2e and directly downstream of the `commitGeometry` change, I isolated it:

```
post-fix (staged tree), 4 isolated runs:  pass, FAIL, pass, FAIL
pre-fix  (commitGeometry(normalizedInput) + full rebuild), 4 runs:  FAIL, FAIL, FAIL, pass
```

Same failure signature in both: `expect.poll(readSize).toEqual(initialSize)` at
`terminal-resize-shrink.spec.ts:245`, receiving `{cols:86, rows:20}` against an expected
`{cols:80, rows:24}`. The failure rate is *no worse* post-fix (2/4) than pre-fix (3/4), and the
mechanism is a race on when `initialSize` is sampled relative to the first xterm fit \u2014 unrelated to
ack semantics.

**Reasoning that this change cannot affect POSIX geometry values at all:** `planGeometryCommit`
passes cols/rows through unchanged (`terminalPresentationRegistry.ts:36-38`), so
`plan.geometry.cols === normalizedInput.cols`; and node-pty's `UnixTerminal.resize` assigns
`this._cols = cols` verbatim (`node_modules/node-pty/lib/unixTerminal.js:249-255`). Therefore
`runtimeObservation.cols === normalizedInput.cols` on POSIX, and the committed value is byte-identical
to pre-fix. The empirical result matches the reasoning. **Pre-existing flake; not a regression; worth
a separate ticket.**

---

## 5. Three-outcome correctness, and the two permanent-lock paths

### Is `applied_unverified` ever treated as a failure? \u2014 **No. Verified by exhaustive trace.**

I enumerated every consumer of the two status vocabularies (`grep` over `src/`, excluding specs) and
walked each one:

| Layer | File:line | Behaviour on unverified |
| --- | --- | --- |
| Host | `resizeAck.ts:26-34` | Returns `applied_unverified` on win32 **and** on a non-positive read-back. Does not throw. |
| Supervisor | `supervisor.ts:418` \u2192 `resizeAck.ts:45-47` | Passes `applied_unverified` through as a first-class value. Throws **only** on malformed/absent \u2014 correctly distinguishing "unknown" from "garbage". |
| Worker runtime | `headlessPtyRuntime.ts:99-107` | Maps to `accepted_unverified`, `changed:false`, `geometry:null`. **Not** `runtime_failed`. |
| Local committer | `localPtyGeometryCommit.ts:161-169` | Maps to `accepted_unverified` and returns **`options.manager.getGeometry(...)`** \u2014 the prior canonical geometry, *not* the request. |
| Hub | `ptyStreamHub.resize.ts:332-341` | Early-returns `accepted_unverified` **before** the `runtime_failed` branch at `:343`, with `createResult(...)` supplying `session.presentationSession.getGeometry()` (`:61`) \u2014 again prior canonical, not the request. |
| Remote parser | `remotePtyStreamMessageHandler.ts:90` | Accepted as a valid status; the `\u2192 runtime_failed` coercion at `:123` is gated on `status === 'accepted'`, so it **cannot** catch `accepted_unverified`. |
| Browser parser | `BrowserPtyGeometryAckCoordinator.ts:33,71` | Identical structure, same gating. |
| Renderer | `syncTerminalNodeSize.ts:180,191` | `status === 'accepted' && result.changed` \u2192 reports `changed:false`. No error path, no retry storm, no user-visible failure. |

**Both halves of the rule hold:** the request is never substituted for an ACK (every unverified path
sources geometry from canonical state via `getGeometry()`), and unknown is never escalated to failed
(no path maps `unverified \u2192 runtime_failed`). The coordinator's stated rationale is correctly
implemented.

The distinction between "unknown" and "malformed" is the detail that convinces me this was
understood rather than pattern-matched: `parsePtyHostResizeResult` (`resizeAck.ts:41-57`) *throws* on
a garbage ack but *returns* on an honest `applied_unverified`. A weaker implementation would have
collapsed both into one bucket.

### P1-1 \u2014 scoped startup retry

The fix is one line (`TerminalRuntimeAvailability.ts:83`):
`startupPhase !== 'ready'` \u2192 `startupPhase === 'initializing'`. So `reconcileWorkspace` is now
reachable in the `unavailable` phase (post-`failStartup`) but still blocked during `initializing`
and shutdown.

**Can a retry globally open admission for other workspaces? No.** `startupPhase` is never mutated by
`reconcileWorkspace`; only the per-workspace map entry is (`:120-127`). Unscoped spawns resolve via
`resolveUnscopedAvailabilitySnapshot` (`:148-152`), which short-circuits on
`startupPhase !== 'ready'` and therefore still refuses. The shipped test asserts exactly this
(`TerminalRuntimeAvailability.spec.ts:71-92`): after a scoped retry succeeds, `'workspace-retry'` is
`{phase:'ready', epoch:1}` and admitted, while `'other-workspace'` **still throws**
`terminal.runtime_not_ready`. Correctly scoped, and it opens a new epoch as the benchmark required.

### P1-2 \u2014 bounded ambiguous-exit retirement

New `PtyHostAmbiguousExitRecovery` (39 lines), 2s default (`supervisor.ts:29`).

**Can the escalation itself wedge? No.** I checked the three ways it could:
1. *Deadline fires but SIGKILL throws* \u2014 `supervisor.ts:184-188` wraps `kill('SIGKILL')` in
   `try/catch` and proceeds to `confirmExit` + `handleHostExit(1)` regardless. The fence clears even
   if the OS refuses the kill. This is the Windows `TerminateProcess`-fails case from round 1, and it
   is now survivable.
2. *Timer leak / stale fire* \u2014 `ambiguousExitRecovery.ts:16-21` clears `pending` **before** invoking
   `onDeadline`, and re-checks `this.pending?.process !== process` inside the timer; `begin()` is
   idempotent per-process and `clear()`s any prior timer. `dispose()` is wired at `supervisor.ts:455`.
3. *Late real exit racing the deadline* \u2014 the `exit` handler calls
   `ambiguousExitRecovery.confirm(child)` (`supervisor.ts:237`) before `confirmExit`, and both the
   deadline path and the exit path re-check `this.process !== child` before mutating supervisor state.
   `PtyHostExitEvidence.confirmExit` is idempotent (WeakSet add + null-out).

Two new tests cover both exits from the state: `'fails closed until a bounded escalation retires an
unconfirmed host'` (`spawnIdentity.spec.ts:72-133`, asserts `SIGKILL` was actually sent, then a later
spawn succeeds) and `'allows a subsequent spawn when an ambiguous host later emits exit'`
(`:135-183`). Round 1's complaint that "the never-recovers behaviour is encoded in a passing test"
is fully answered \u2014 the fail-closed assertions were kept *and* recovery is now proven.

The `kill(signal?: 'SIGTERM'|'SIGKILL')` signature widening (`processTypes.ts:6`) is correctly
threaded: the node adapter forwards the signal (`nodeProcessAdapter.ts:53-54`), and the Electron
utility-process adapter explicitly ignores it (`electronUtilityProcessAdapter.ts:31`) because
`UtilityProcess.kill()` takes no signal \u2014 the right call, not an oversight.

### T3 WeakSet capability containment \u2014 **UNCHANGED, not eroded**

The entire round-2 diff to `TerminalRuntimeAvailability.ts` is **one line** (the P1-1 gate above).
Every containment property I praised in round 1 is byte-identical: the `WeakSet` (`:22`), the frozen
scope (`:89`), the four-part identity check in `isCurrentRecoveryScope` (`:127-140`: WeakSet identity
**and** workspaceId **and** `phase === 'initializing'` **and** attempt equality), and the
`finally { recoveryScopes.delete(scope) }` lifetime (`:104`). The `unknown` parameter type is
retained. The single-writer property still holds. **No erosion.**

---

## 6. New findings from the remediation

Both are P2. Neither blocks.

### NEW-1 (P2) \u2014 On Windows, canonical geometry can never advance through the resize path

`resizeAck.ts:26-30` returns `applied_unverified` **unconditionally** on win32, and there is no
deferred re-read anywhere (`grep` for `setImmediate|nextTick|setTimeout` in `entry.ts`/`resizeAck.ts`
\u2192 none). Every Windows resize therefore lands in the `accepted_unverified` branch, which by design
does **not** commit (`localPtyGeometryCommit.ts:161-169`). Since `commitGeometry` is only otherwise
reached on the `!plan.changed` no-op path (`:104`), **canonical geometry on Windows is frozen at its
spawn value for the life of the session** \u2014 while ConPTY itself *does* move, because
`pty.resize(cols, rows)` is still issued at `resizeAck.ts:23`.

The net effect is a real ConPTY-vs-canonical divergence, and the renderer will re-apply the stale
canonical size to xterm (`syncTerminalNodeSize.ts:168-178`). The implementer knew this and encoded
it: `tests/e2e/pty-host.resize-ack.windows.spec.ts:41-46` explicitly asserts the snapshot stays at
the pre-resize size.

**Why this is P2 and not P1:** it is not a regression. On `origin/main` the Windows ACK was a
*fabricated* verified value \u2014 canonical advanced to a number nobody had observed, which is the
dishonesty this whole line exists to remove. Trading "confidently wrong" for "honestly unknown" is
the correct direction and matches the coordinator's rule. But the three-outcome model is only
*complete* once something can later promote unverified \u2192 verified. The cheap fix is available:
`WindowsTerminal.resize` updates `_cols/_rows` inside its deferred callback
(`node_modules/node-pty/lib/windowsTerminal.js:129-133`), so a `setImmediate` re-read in
`resizePtyAndReadAck`, or a follow-up observation message, would close it. **Recommend a tracked
follow-up before Windows GA.**

Related, smaller: on POSIX, `applied_verified` reads `pty.cols/rows`, which node-pty assigns from the
request (`unixTerminal.js:253-254`). So the read-back is structurally correct \u2014 the layer is no
longer inventing values, and any future clamping node-pty exposes will flow through \u2014 but it still
cannot *observe* kernel clamping. A true `TIOCGWINSZ` query would. Round 1 named this the acceptable
minimum, and the implementer took it; noting it so nobody later mistakes `applied_verified` for
"confirmed by the kernel".

### NEW-2 (P2) \u2014 `pnpm arch:doc-sync` fails on the staged tree

Round 1 recorded this gate as PASS; it now fails (W8). I traced both causes:

1. **Branch-caused, and expected:** `docs/architecture/CONTROL_SURFACE.md` is a contract doc
   (`check-doc-sync.mjs:7-11`) changed without harness sync evidence. The script provides an explicit
   escape hatch for wording-only edits (`OPENCOVE_ARCH_DOC_NO_RULE_IMPACT=1`), requiring the
   no-rule-impact decision be documented in review. **I am recording that decision here: the
   CONTROL_SURFACE.md edit adds prose describing the three-outcome resize vocabulary and introduces
   no new architecture rule, layer, or boundary. No harness rule impact.** With that flag set, cause 1
   clears.
2. **Pre-existing on `origin/main`, NOT branch-caused:** stale audit results. I regenerated on a clean
   `origin/main` worktree and got the identical three-file drift (`layer-dependency.jsonl`,
   `summary.json`, `window-opencove-api.jsonl`). The drift entries name `SettingsPanel.tsx`,
   `AppShell.tsx`, `addProjectWizard/*` \u2014 **none touched by this branch** \u2014 and
   `git diff origin/main -- harness/architecture/results` is empty.

Round 1's PASS was itself vacuous for the same reason the other staged gates were: the script reads
`git diff --cached`, which was empty. So this is not a new breakage so much as a gate that only
started working once files were staged. **Not blocking:** `arch:doc-sync` is in neither
`.github/workflows/ci.yml` nor the `pre-commit` chain. Someone should refresh the audit results on
main.

---

## 7. Declined P2 \u2014 the two 499-line files

**Confirmed truly untouched by round 2, and the decline is legitimate.**

`git diff --cached --name-only | grep -E 'sessionLaunchAgentInMount|controlSurfaceHttpServer'`
returns nothing. Both files sit at exactly **499 lines** against the 500-line gate \u2014 one line of
headroom.

They were modified by the *earlier* branch commits, and the direction was strongly positive:
`sessionLaunchAgentInMountHandler.ts` is **\u2212129 net lines** vs `origin/main`. `supervisor.ts`, which
round 1 flagged at 498, is now **478** after `processLogging.ts` (36 lines) and
`ambiguousExitRecovery.ts` (39 lines) were extracted \u2014 so round 2 actively *improved* the worst of
the three. `check-max-lines` passes (W2). Declining to refactor two unrelated files inside a P0
remediation is correct scoping. The residual risk is narrow and mechanical: the next one-line edit to
either file trips the gate and forces an unplanned extraction. Worth a housekeeping ticket, not a
blocker.

---

## 8. Not-regressed checks (re-confirmed)

- **Multi-client controller/viewer authority, epoch+CAS, remote fencing.** The full-branch diff over
  `ptyStream/**` + `remote/**` is 3 files / +17 \u221219. Filtering that diff for
  `epoch|revision|lease|authority|controller|fence` yields exactly **two removed lines** \u2014 both from
  the deleted `normalizeResizeResult` request-echo fallback (`multiEndpointPtyRuntime.ts`). The
  `isGeometryLeaseCurrent` post-await re-check and `correctRuntimeAfterGeometryLeaseLoss` are
  untouched. `remotePtyEndpointProxy*`, worker-instance and fence files: **zero diff vs main**.
- **Protocol version bump** `2 \u2192 3` (`protocol.ts:1`) is consistently applied to host, `poc.ts`, and
  all test fixtures, and is enforced by the existing mismatch guard (`supervisor.ts:255-261`). Host
  and supervisor ship in the same bundle, so no mixed-version window exists.
- **No lockfile / schema / unrelated-file churn** in the 33 staged files.

---

## 9. Cross-platform residual risk (stated plainly)

**All of my verification was macOS-only.** Nothing below was executed on Windows or Linux by me.

**Windows.** Materially better than round 1, but one open item:
1. **NEW-1 is the real residual risk.** Every ConPTY resize is honest-but-unverified, so canonical
   geometry never advances and diverges from the ConPTY the app just resized. Correct-by-design, but
   incomplete. **This is the top thing to check on a Windows box.**
2. Round 1's worst Windows hazard \u2014 a failed `TerminateProcess` permanently bricking the supervisor \u2014
   is **closed** by the bounded 2s escalation, and the escalation survives a throwing `kill()`
   (`supervisor.ts:184-188`). The `exitOnKill = false` test double simulates exactly the Windows
   failure mode and now proves *recovery* rather than encoding permanence.
3. **The new `*.windows.spec.ts` is real, not a stub.** Named to match the CI filter
   `OPENCOVE_E2E_TEST_MATCH: '**/*.windows.spec.ts'` on `windows-latest` (`ci.yml:184,208-213`), it
   drives the genuine IPC path \u2014 `window.opencoveApi.pty.resize` \u2192 `localPtyGeometryCommit` \u2192
   `ptyHost.resize` (`runtime.ts:235`) \u2192 `supervisor.resize` \u2192 `entry.ts:317` \u2192 real node-pty ConPTY.
   Its assertions are hard (`status: 'accepted_unverified'`, plus
   `expect(result.after).not.toMatchObject({cols:120, rows:40})`), and the snapshot fields it reads
   are required contract fields (`terminal.ts:152-154`), so it cannot pass vacuously on undefined.
   It is `test.skip` on macOS by design. **On Windows it is meaningful.** Caveat: it pins *current*
   behaviour, so if NEW-1 is later fixed, this spec must be updated in the same change.
4. Still unexercised on Windows: process-tree kill interaction with the spawn-identity registry
   (round 1 item 4), and `terminal-resize-shrink` remains `test.skip` on win32 (`:200`), so the
   benchmark's "S1 passes on macOS **and** Windows" criterion is still unmet.

**Linux.** Low risk \u2014 POSIX read-back and SIGTERM/SIGKILL semantics match macOS, and the branch adds
no Linux-specific path. Unexecuted here; CI has no Linux e2e runner.

---

## 10. What a human should check first

**NEW-1: run the terminal on Windows and resize it.** Everything else in this remediation I was able
to verify mechanically, and it held up under adversarial falsification. NEW-1 is the one thing that
can only be settled by watching a real ConPTY session: confirm that a resized Windows terminal reflows
correctly, and decide whether "canonical geometry never advances on Windows" is acceptable until a
deferred re-read lands. My read is that it is safer than what shipped before \u2014 honest-unknown beats
confidently-wrong \u2014 but it should be a tracked follow-up with an owner, not an unremarked side effect.

Second: land the change (it is still only staged) and file the two housekeeping tickets \u2014 the
`terminal-resize-shrink` pre-existing flake and the stale `harness/architecture/results` on main.

---

## 11. Why ACCEPT

Round 1's rejection was about the gap between "it works" and "it is proven to keep working." That gap
is closed, and closed honestly:

- The P0 was fixed with **+3 lines and zero deleted assertions** \u2014 the narrowest possible fix, using
  the exact helper prescribed. I looked hard for smuggled weakening across every touched spec and
  found none; where tests changed, they got *stronger*.
- **All four new invariants are falsifiable.** I broke each fix and watched the corresponding test go
  red. This is the property round 1 was missing.
- The two permanent-lock paths are fixed with **bounded, testable** mechanisms, and the fail-closed
  assertions were preserved alongside the new recovery assertions.
- The three-outcome model is implemented with real care \u2014 particularly the malformed-vs-unknown
  split, which is the detail that separates understanding from pattern-matching.
- `pre-commit` is green **with a non-empty staged set**, so the gates that were vacuous in round 1
  genuinely executed this time.
- T3's WeakSet containment survived untouched.

The two P2s are honest residue, not hidden defects \u2014 one is a design-complete-but-incomplete Windows
path that is still strictly better than main, the other is mostly pre-existing drift on a gate that
runs in neither CI nor pre-commit.
