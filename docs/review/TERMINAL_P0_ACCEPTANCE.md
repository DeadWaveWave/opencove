# Terminal P0 Line — Independent Acceptance Review

> **Current status: this round-1 REJECT is SUPERSEDED.**
> See [`TERMINAL_P0_ACCEPTANCE_ROUND2.md`](./TERMINAL_P0_ACCEPTANCE_ROUND2.md) for the round-2
> re-review (verdict: **ACCEPT-WITH-FOLLOWUPS**). Round 1 is retained below, unedited, as the
> historical record.

---

## Round 1 (superseded)

**VERDICT: REJECT** (blocking: 1 × P0 test regression + a false verification claim; the underlying production design is good and close to acceptable once the P0 is fixed)

- Reviewer: independent acceptance gate (Phase 3), not the implementer
- Worktree: `/Users/shihaojie/orca/workspaces/opencove/terminal-stability`, branch `DeadWaveWave/terminal-stability`
- Commits under review: `14ed4b94` (T1), `e75535b7` (T2), `713db510` (T3)
- Baseline: `origin/main` = `f36a1d48`

Rejection is driven by **process/verification integrity**, not by a broken feature: the branch ships
with two red unit tests that guard the single most important data-loss invariant in this line, and
the delivery claimed a clean `pnpm pre-commit`. The T1/T2/T3 production designs themselves are
mostly sound and, in T3's case, notably well built. Fixing findings P0-1 is likely a small change;
the review should be re-run afterwards.

---

## 1. Verification I personally reproduced

All commands run by me in this worktree at `713db510`.

| # | Command | Real observed result |
| --- | --- | --- |
| V1 | `pnpm check` | **PASS** — `EXIT=0` (`tsc -b`, no errors) |
| V2 | `pnpm exec vitest run` (full unit/contract/integration) | **FAIL** — `Test Files 1 failed \| 425 passed \| 4 skipped (430)`, `Tests 2 failed \| 1682 passed \| 6 skipped (1690)` |
| V3 | `pnpm test:e2e` | **FAIL (exit 1)** — `2 failed, 47 skipped, 262 passed (15.1m)` |
| V4 | `pnpm test:terminal-recovery:native` | **PASS** — `Test Files 3 passed (3)`, `Tests 3 passed (3)` |
| V5 | `pnpm lint` | **PASS** — `Found 0 warnings and 0 errors.` (1859 files) |
| V6 | `pnpm format:check` | **FAIL** — `[warn] tests/contract/ipc/ptyRuntimeGeometry.spec.ts` |
| V7 | `pnpm arch:check` | **PASS** — `0 error(s), 0 warning(s), 1144 file(s) analyzed` |
| V8 | `pnpm arch:doc-sync` | **PASS** — `Architecture doc sync check passed.` |
| V9 | `pnpm ui:style-check`, `check-naming-staged`, `check-max-lines` on changed files | **PASS** — no output/violations |

### V2 detail — the two failing unit tests

```
FAIL tests/unit/app/sessionPrepareOrReviveHandler.remoteRecovery.spec.ts
  > reattaches a persisted remote route before deciding to spawn a replacement shell
    AssertionError: expected false to be true   (spec:93  expect(result.ok).toBe(true))
  > does not spawn a replacement when remote recovery rejects transiently
    AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times  (spec:134)
```

**Proven to be a regression introduced by this branch**, not pre-existing:

```
$ git log --oneline origin/main..HEAD -- tests/unit/app/sessionPrepareOrReviveHandler.remoteRecovery.spec.ts
0            # the test file itself was never touched by these commits

$ cd /tmp/rev/mainwt && pnpm exec vitest run tests/unit/app/sessionPrepareOrReviveHandler.remoteRecovery.spec.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)          # <- green on origin/main

$ cd <worktree> && pnpm exec vitest run tests/unit/app/sessionPrepareOrReviveHandler.remoteRecovery.spec.ts
 Test Files  1 failed (1)
      Tests  2 failed (2)          # <- red on HEAD
```

I isolated the exact failure by instrumenting a temporary probe spec (since deleted) that invoked
the handler the same way the stale test does:

```json
{ "ok": false,
  "error": { "code": "common.unexpected",
             "debugMessage": "TypeError: Cannot read properties of undefined (reading 'reconcileWorkspace')" } }
```

### V3 detail — the two failing E2E tests are NOT regressions

| Failing E2E | Verdict | Evidence |
| --- | --- | --- |
| `workspace-canvas.agent-status-watcher.spec.ts:185` | **flaky** | passed on isolated rerun in this worktree |
| `workspace-canvas.selection.spaces.marquee-inside.spec.ts:12` | **pre-existing on main** | reproduced identically in `/tmp/rev/mainwt` (built from `origin/main`): `1 failed` |

Neither touches terminal code. So the E2E result is *not* a blocker — but the claim of
"264 passed / 47 skipped / 0 failed" does not match reality (I observed 262/47/2).

### Why the implementer's "pre-commit passed" claim was wrong

`pnpm pre-commit` runs `pnpm test:staged` -> `scripts/run-vitest-related-staged.mjs`, which resolves
files from `git diff --cached` and, at `scripts/run-vitest-related-staged.mjs:76-78`, does:

```js
if (files.length === 0) {
  process.exit(0)      // silently green
}
```

The same is true for `line-check:staged`, `format-check:staged`, `naming-check:staged`. Because the
work was already committed (nothing staged), those gates were **no-ops that exit 0**. The stale
`format:check` violation in T1's own new test file (V6) independently confirms the format gate never
actually inspected these changes.

---

## 2. Findings

| Sev | Issue | File:line | Evidence | Suggested fix |
| --- | --- | --- | --- | --- |
| **P0-1** | `registerSessionPrepareOrReviveHandler` gained a required dep `terminalRecoverySpawnAdmission`; the existing regression tests for the **remote-recovery / no-displacement invariant** were not updated and now fail. The whole recovery path degrades to a generic `common.unexpected` for any un-updated caller instead of failing loudly. | `src/app/main/controlSurface/handlers/sessionPrepareOrReviveHandler.ts:61-80`; broken tests `tests/unit/app/sessionPrepareOrReviveHandler.remoteRecovery.spec.ts:79,119` | V2 above: 2 red on HEAD, green on main; probe shows `TypeError: ... reading 'reconcileWorkspace'` | Update the two tests to inject an admission double (`createReadyTerminalAdmissionDeps()` already exists at `tests/unit/contexts/controlSurfaceTestTerminalAvailability.ts:3`). Both tests must be *kept*, not deleted — they are the only regression assets for "remote recovery rejection must not spawn a replacement". |
| **P1-1** | **`failStartup()` is permanently terminal.** A transient persistence read failure at Worker startup bricks *all* terminal spawns for the entire app session; no retry, no new epoch. Directly contradicts the report's own fallback requirement ("失败不得把终端永久锁死，用户重试或成功恢复必须开新 epoch", benchmark:322). | `src/contexts/terminal/application/TerminalRuntimeAvailability.ts:40-44,80-83`; caller `src/app/main/controlSurface/terminalRecovery/terminalRuntimeStartup.ts:18-22` | I probed the class directly: after `failStartup()`, a later `completeStartup(['ws'])` leaves `{phase:'unavailable',epoch:0}` and `reconcileWorkspace('ws',…)` throws `terminal.runtime_not_ready`; final snapshot still `{phase:'unavailable',epoch:0}`. | Allow `completeStartup` (or an explicit `retryStartup`) to transition `unavailable -> initializing/ready` and open a new epoch, or retry `initializeTerminalRuntimeAvailability` on demand. Add a test "failed startup can be retried into a new ready epoch". |
| **P1-2** | **Ambiguous host exit can permanently brick the supervisor.** `handleHostError` marks the child ambiguous and calls `child.kill()`, but deliberately does *not* clear `this.process`/`readyPromise`. The only exit from that state is the child's `exit` event. If it never arrives (hung child; Windows `TerminateProcess` failure), every later `ensureReady()` throws forever. On main this path called `handleHostExit(1)`, which cleared state and allowed a backoff restart — so this is a **new** liveness failure mode. | `src/platform/process/ptyHost/supervisor.ts:161-180` (`handleHostError`), `:298-301` (`assertNoAmbiguousExit`); `src/platform/process/ptyHost/hostExitEvidence.ts:22-26` | The shipped test `tests/unit/platform/ptyHostSupervisor.spawnIdentity.spec.ts:72-106` sets `exitOnKill = false` and asserts the *permanent* rejection, then disposes — the never-recovers behaviour is encoded, and no test covers recovery. | Add a bounded deadline: if no `exit` within N ms after the forced kill, escalate (SIGKILL / treat as confirmed) and clear the fence. Add a test "ambiguous host that later exits allows a subsequent spawn". Fail-closed is right; **fail-closed forever** is not. |
| **P1-3** | **T1 is incomplete at the host boundary: the ACK content is still the request echoed back.** `resizeSession` replies with `request.cols/rows`, never reading what node-pty actually holds. So the invariant "reported geometry == host-applied geometry" currently only holds because "node-pty did not throw". | `src/platform/process/ptyHost/entry.ts:316-322` — `session.pty.resize(request.cols, request.rows)` then `result: { …, cols: request.cols, rows: request.rows }` | T1's commit `14ed4b94` did not touch `entry.ts` at all (`git log --oneline origin/main..HEAD -- src/platform/process/ptyHost/entry.ts` -> only `e75535b7`). node-pty stores the requested value verbatim (`node_modules/node-pty/lib/unixTerminal.js:253-255`) and on Windows applies it **deferred/async** (`windowsTerminal.js:129-133`), so the ACK is sent before ConPTY has applied anything. | Reply with `session.pty.cols/rows` read back after `resize()` at minimum; ideally query real geometry (`TIOCGWINSZ`) so clamping is observable. On Windows, ACK only after the deferred apply completes. |
| **P1-4** | **Residual "echo the request as an ACK" path on the remote route.** `ptyStreamHub.resize.ts:343` still does `runtimeResult?.geometry ?? plan.geometry`. This is unreachable for the local runtime (which now returns `geometry:null` only with `status:'runtime_failed'`, filtered at `:332`), but the remote parser can legitimately produce `status:'accepted'` **with `geometry:null`** — and then the requested geometry is committed and broadcast as if acknowledged. | `src/app/main/controlSurface/ptyStream/ptyStreamHub.resize.ts:343`; parser `src/app/main/controlSurface/remote/remotePtyStreamMessageHandler.ts:100-110` returns `geometry = null` whenever cols/rows are absent/non-positive while `status` stays `'accepted'`; type permits it (`src/shared/contracts/dto/terminal.ts:88-95`) | Code + type reading; not covered by any test I could find. | Treat `accepted && geometry == null` as `runtime_failed` (or reject at the parser). The report itself asked to "核对 `??` 兜底是否仍需要" (benchmark P0-1 bullet) — that check was not completed. |
| **P1-5** | `supervisor.resize` falls back to the **request** value when the host omits cols/rows: `cols: response.result.cols ?? cols`. Latent today (host always sets them) but the protocol types them optional, so it is the same defect one layer down. | `src/platform/process/ptyHost/supervisor.ts:435-438`; protocol `src/platform/process/ptyHost/protocol.ts:63` (`result: { sessionId: string; cols?: number; rows?: number }`) | Code reading. | Make cols/rows required in the resize response type, or throw when absent instead of substituting the request. |
| **P2-1** | Prettier violation in T1's own new test file. | `tests/contract/ipc/ptyRuntimeGeometry.spec.ts:42-43` | V6; `prettier` would join the two lines into one. | `pnpm format`. Also proves the format gate never ran (see §1). |
| **P2-2** | Three touched files sit at 499/499/498 lines against the 500-line gate — any follow-up edit trips it. | `sessionLaunchAgentInMountHandler.ts` (499), `controlSurfaceHttpServer.ts` (499), `supervisor.ts` (498) | `git diff --name-only origin/main..HEAD \| xargs wc -l \| sort -rn` | Note as known debt; T2/T3 already split helpers out, which is the right direction. |

**Counts: P0 = 1, P1 = 5, P2 = 2.**

---

## 3. Invariant-by-invariant proof status

| # | Invariant | Status | Basis |
| --- | --- | --- | --- |
| I1 | Reported geometry == host-applied geometry; a request value is never echoed as an ACK | **PARTIAL / code-only at the boundary** | Proved *for the Worker layer* by `tests/contract/ipc/ptyRuntimeGeometry.spec.ts:16-66` — mock host returns 91×27 for a 120×40 request and the runtime must report 91×27. That is a genuine, well-designed regression asset. **But** the host itself still echoes the request (`entry.ts:321`, finding P1-3) and the remote path can still echo (P1-4). So the end-to-end invariant is *not* proved; only "the Worker no longer discards what the host said" is proved. |
| I2 | At most one live PTY per spawn request; a retry never leaves an unreferenced PTY | **PROVED BY TEST** | `tests/unit/platform/ptyHostSupervisor.spawnIdentity.spec.ts`: `:6` host-side dedupe returns the existing session for a duplicate `launchId`; `:19` retry after a *confirmed* exit reuses the same `launchId`; `:72` ambiguous transport loss fails closed; `:109` plain timeout sends exactly one `spawn` message. Host-side dedupe is atomic because it lives in the single-threaded message loop (`entry.ts:271-279`). Caveat: the retry path always lands on a *fresh* host, so the dedupe registry is defence-in-depth rather than the actual guard — the real guard is `isRetrySafe`. |
| I3 | No spawn admitted before runtime ready; rejection is typed and user-explicable | **PROVED BY TEST** | Contract test over real HTTP: `tests/contract/controlSurface/controlSurfaceHttpServer.terminalAdmission.spec.ts:88-110` — `session.spawnTerminal` returns `terminal.runtime_not_ready` with `spawnCalls == 0`, then `session.prepareOrRevive` spawns exactly 1, then a normal spawn is admitted (2). Typed code registered at `src/shared/contracts/dto/error.ts:53` and `src/shared/errors/appError.ts:62`; localized en/zh-CN with a dedicated message test (`tests/unit/app/terminalRuntimeNotReadyMessage.spec.ts`). |
| I4 | Restart recovery is never displaced by a racing auto-spawn | **REGRESSED TO UNPROVEN** | The mechanism exists and is good (§4), and I3's contract test covers the local ordering. But the two tests that specifically prove *remote* recovery is not displaced — "reattaches a persisted remote route before deciding to spawn a replacement" and "does not spawn a replacement when remote recovery rejects transiently" — are **red** (finding P0-1). This is exactly the benchmark's "最重要的数据丢失防线" (benchmark:415), and it is currently unguarded. |
| I5 | Runtime failure must not permanently lock terminals | **DISPROVED (code + probe)** | `failStartup()` is terminal (P1-1) and ambiguous host exit is terminal (P1-2). Both contradict benchmark:322. |

---

## 4. Verdict on the T3 recovery-bypass containment (the key risk)

**CONTAINED — this is the strongest part of the delivery.** Both of the explicitly required properties hold.

**Requirement (a): a distinct internal entry point, NOT a boolean flag on the normal spawn API — MET.**
The bypass is an **unforgeable capability object**, which is stronger than what was asked for:

- `src/contexts/terminal/application/TerminalRuntimeAvailability.ts:21` — `private readonly recoveryScopes = new WeakSet<TerminalRecoverySpawnScope>()`
- `:87-89` — the scope is `Object.freeze({workspaceId, attempt})`, registered in that WeakSet, and handed **only** to the `operation` callback inside `reconcileWorkspace`
- `:127-139` — `isCurrentRecoveryScope` requires **object identity** (`recoveryScopes.has(candidate)`) *plus* matching `workspaceId`, *plus* `phase === 'initializing'`, *plus* `attempt` equality
- `:103` — `finally { this.recoveryScopes.delete(scope) }` closes the window as soon as reconciliation ends

Because admission turns on WeakSet identity, a caller cannot forge one by sending `true` or a
look-alike `{workspaceId, attempt}` JSON object. The parameter is typed `unknown` (`:62`), which is
the right call: it forces the check to be structural rather than trusting the type.

**Requirement (b): a test proving a user-initiated / node-auto-spawn path CANNOT reach it — MET, at two layers.**

- Unit: `tests/unit/terminalRecovery/TerminalRuntimeAvailability.spec.ts:25-37` — *inside* an active reconciliation, a normal spawn (`scope = null`) still throws `terminal.runtime_not_ready`, and the valid scope is rejected for a *different* workspace. `:39-66` — a failed reconciliation stays `unavailable`, and a scope surviving into shutdown is rejected.
- Contract, over real HTTP: `controlSurfaceHttpServer.terminalAdmission.spec.ts:88-110` (see I3) — a genuine user-initiated `session.spawnTerminal` is refused with 0 spawns while recovery is pending.
- Handler-level: `tests/unit/contexts/controlSurface.sessionLaunchAgentInMount.spec.ts:53-121` — a direct mounted agent launch is refused, and it asserts `admissionSpy).toHaveBeenCalledWith('project-local', undefined)`, i.e. the public context carries **no** scope.

**Leak analysis I performed independently.** The one plausible escape is context propagation:
`sessionPrepareOrReviveHandler.ts:77` builds `recoveryContext = {...ctx, terminalRecoverySpawnScope: recoveryScope}`. I traced every reader of that field:

```
src/app/main/controlSurface/types.ts:6                       (declaration, optional unknown)
handlers/sessionHandlers.ts:135
handlers/sessionStreamingHandlers.ts:275, :413
handlers/resolveAdmittedMountAgentLaunch.ts:42
handlers/ptyMountHandlers.ts:193
handlers/sessionPrepareOrReviveHandler.ts:77                 (sole writer)
```

There is exactly **one writer**, and it is the recovery handler. The public HTTP context is built
once at server registration (`controlSurfaceHttpServer.ts:57-78`) and never carries the field, so no
externally-originated request can arrive with a scope attached. Combined with the WeakSet identity
check, forging or replaying a scope from outside is not possible. **No P0 finding here.**

Residual (P2, not blocking): the escape hatch is only as good as the "one writer" rule, which is
enforced by convention rather than by the type system (`terminalRecoverySpawnScope?: unknown` is
declared on the shared public context type). A future handler could spread a recovery context into
an unrelated nested invoke. Consider moving the field off the public `ControlSurfaceContext` into a
separate internal context type so the compiler enforces what is currently a discipline.

---

## 5. Verdict on the T2 report correction

**The correction is ACCURATE and honest.** I verified it against the pre-change code rather than taking it on trust.

The amended text (`docs/research/TERMINAL_CLEANCODE_BENCHMARK.md:257-263`) says a plain
`spawn timeout` only rejects the current call and never triggered a retry, and that Phase 1's
"超时后无条件重试" was wrong. On `origin/main`:

- `supervisor.ts:380-390` (main) computes `hostLost = !this.process || !this.readyPromise || (attemptedChild !== null && this.process !== attemptedChild)`.
- The timeout originates in `pendingResponseCoordinator.ts:17-20`, which only rejects the pending promise. It does **not** call `handleHostExit`.
- Therefore, on a pure timeout, `this.process` is still the same child and `readyPromise` is still set -> `hostLost === false` -> **no retry**. Confirmed.
- The real pre-existing hazard was the *transport-error* branch: `requestHostResponse`'s `postMessage` failure callback called `handleHostExit(1)` (main, `supervisor.ts:332-338`), which nulls `this.process`, making `hostLost` true and retrying — while the old host might still be alive holding a PTY. That is precisely what the amended text describes.

So Phase 1 overstated the trigger, the amendment corrects it in the right direction, and it does not
soften the severity (the row stays **P0** at benchmark:291). The amendment also correctly narrows the
claimed remedy to "launch identity + confirmed retry, ambiguous transport loss fails closed" rather
than importing cleancode's file lock. **Good-faith, technically correct documentation.**

One nit: the amendment says OpenCove "应让歧义 transport loss 失败关闭" and the code now does — but
neither the doc nor the code acknowledges that failing closed is currently *permanent* (finding
P1-2). The doc should state the liveness trade-off it just accepted.

---

## 6. Cross-platform residual risk (stated plainly)

The implementer is right that Windows/ConPTY paths were not executed; everything below was verified
on macOS only. This matters more than usual because **T2 and T3 touch process lifecycle, where
Windows semantics genuinely differ.**

**Unverified on Windows:**

1. **The ambiguous-exit fence (P1-2) is most dangerous here.** `PtyHostProcess.kill()`
   (`processTypes.ts:7`) maps to `TerminateProcess` on Windows, which can fail (e.g. the process is
   already terminating, or access is denied) — and Node then may not emit `exit`. That is exactly
   the input that makes the supervisor permanently unavailable. On POSIX, SIGTERM→exit is far more
   reliable. The one shipped test for this path (`spawnIdentity.spec.ts:72`) uses
   `exitOnKill = false`, i.e. it *simulates the Windows-like failure and asserts permanent
   rejection* — the risky behaviour is encoded, not fixed.
2. **T1's ACK is provably wrong-shaped on Windows.** `WindowsTerminal.resize` defers the actual
   apply (`node_modules/node-pty/lib/windowsTerminal.js:129-133`: `this._deferNoArgs(() => { agent.resize(...) })`),
   so `entry.ts:321` replies "applied" *before* ConPTY has applied anything. Combined with P1-3
   (echoing the request), the Windows ACK is a promise, not an observation. Open question #4 in the
   benchmark (benchmark:452) anticipated exactly this and asked for diagnostics first — that has not
   been done.
3. **The `terminal-resize-shrink` E2E — the flagship geometry proof — is `test.skip` on Windows**
   (`tests/e2e/workspace-canvas.terminal-resize-shrink.spec.ts:200`, "Authoritative PTY geometry
   requires POSIX stty"). So the platform most likely to clamp geometry is the one platform with no
   end-to-end geometry assertion. The benchmark's own S1 acceptance criterion required
   "`terminal-resize-shrink` E2E 在 macOS + **Windows** 通过" (benchmark:434) — **not met**.
4. **Windows process-tree kill interaction with the new identity registry** is unexercised:
   `killSession` calls `spawnIdentities.release(...)` then `terminatePtySession` →
   `killWindowsProcessTree` (`entry.ts:325-334`, `:175-186`). If the tree kill partially fails, the
   launch identity has already been released while a process may survive — untested on Windows.
5. Per `DEVELOPMENT.md`, platform-specific fixes require `*.windows.spec.ts` coverage run on a
   Windows runner. No such test was added for T1/T2/T3.

**Linux:** lower risk (POSIX `stty`/SIGTERM semantics match macOS), but still unexecuted here. The
E2E suite would need to run on a Linux runner to claim parity; note the repo already treats Linux
`process.abort()` as flaky (`entry.ts:344-347`), which hints CI behaviour differs.

**Recommendation:** do not ship T2 to Windows users without either a bounded deadline on the
ambiguous fence (P1-2) or Windows CI evidence that the `exit` event reliably follows `kill()`.

---

## 7. Confirmation: existing OpenCove strengths were NOT regressed

This was an explicit constraint and it was respected. Strongest evidence is that the multi-client
core was **not modified at all**:

```
$ git diff origin/main..HEAD --stat -- 'src/app/main/controlSurface/ptyStream/**' 'src/contexts/terminal/**'
 src/contexts/terminal/application/TerminalRuntimeAvailability.ts | 162 +++++++++++++++++++++
 1 file changed, 162 insertions(+)
```

That is a pure addition. Concretely:

- **Controller/viewer authority** — `ptyStreamHub.*` untouched; `isGeometryLeaseCurrent` and the
  post-await lease re-check at `ptyStreamHub.resize.ts:344-366` are unchanged, including the
  `correctRuntimeAfterGeometryLeaseLoss` compensation path.
- **Epoch + CAS geometry** — `authorityEpoch` / `baseGeometryRevision` plumbing is unchanged; T1
  only replaced the *values* placed into `geometry.cols/rows`, leaving `revision: null` exactly as
  before (`headlessPtyRuntime.ts:104-107`), so no CAS semantics shifted. T3's `epoch` is a
  *separate*, per-workspace admission epoch and does not interact with the geometry authority epoch —
  consistent with the benchmark's "两者正交" analysis.
- **Remote-worker fencing** — `remotePtyEndpointProxy*.ts` untouched; endpoint/session/worker-instance
  fences intact. (The one remote-path concern I raise, P1-4, is a *pre-existing* `??` fallback that
  T1 was asked to re-examine and didn't — not a new regression.)
- **Replay / scrollback** — no changes to replay window or presentation snapshot logic; the
  persistence and reopen E2E families all passed in my run (e.g. `workspace-canvas.persistence.spec.ts:186,272,401`,
  `recovery.agent-input-after-window-reopen.spec.ts:379,419`).
- **Docs** updated coherently rather than quietly redefined: `MULTI_CLIENT_ARCHITECTURE.md` gains
  invariant 18 and an ownership row; `RECOVERY_MODEL.md` gains invariant 10;
  `CONTROL_SURFACE.md` documents the scope as runtime-only and never client-supplied. `pnpm arch:doc-sync`
  and `pnpm arch:check` both pass (V7/V8), so the architecture-contract gate was genuinely satisfied.

**No DB schema change, no lockfile edit, no unrelated files** (check H):

```
$ git diff --stat origin/main..HEAD -- pnpm-lock.yaml package.json 'src/platform/persistence/**'
(empty)
```

All 48 changed files are plausibly in scope for T1/T2/T3.

---

## 8. DEVELOPMENT.md risk checklist

| Check | Assessment |
| --- | --- |
| **Async gaps** | Mostly good. T3 re-checks state *after* the await via `completeReconciliation`'s `current.attempt !== attempt` guard (`TerminalRuntimeAvailability.ts:120-123`) — a late completion from a superseded attempt cannot reopen admission, and the shipped test at `:39-66` proves the shutdown-during-await case. Gap: unlike cleancode's `assertStartAllowed` (checked before *and* after the await), the spawn handlers check admission once; a workspace transitioning mid-await is not re-validated. |
| **Duplicate / out-of-order events** | T2 handles this well: `attempt` monotonicity in T3, `launchId` dedupe in the host's single-threaded loop, and `confirmExit` returning the *forced* exit code so an ambiguous kill isn't misreported as the child's own status (`hostExitEvidence.ts:17-21`). Note D3 from the benchmark (host exit code masquerading as PTY exit code) is **still open** — out of scope for this line, but the `forcedExitCodes` map is a partial step. |
| **Resource lifecycle** | `recoveryScopes` uses a WeakSet and is explicitly deleted in `finally` — no leak. Host identities released on exit/kill/cleanup (`entry.ts:265,332,197`). **Gap:** no timer bounds the ambiguous-exit fence (P1-2), and `readyTimer` does not clear the ambiguous flag. |
| **Restart semantics** | Design is right — runtime observation never overwrites durable fact, and non-ready blocks spawn rather than inventing a fresh shell. **But** the proof is currently red (P0-1), so this is asserted, not demonstrated, on the remote path. |
| **IPC validation** | Good. The bypass is never accepted from the wire (§4); the new error code is a registered typed code, not a string; the remote geometry parser validates cols/rows positivity (though see P1-4 for what it does with the failure). |
| **Performance** | No new work on the hot output path. Resize adds no allocation beyond what existed. `resolveUnscopedAvailabilitySnapshot` does an O(workspaces) scan (`TerminalRuntimeAvailability.ts:148-152`) but only on unscoped spawn, not per-frame — acceptable. |

---

## 9. What I'd tell a human to look at first

**The two red tests in `tests/unit/app/sessionPrepareOrReviveHandler.remoteRecovery.spec.ts`.**
Not because fixing them is hard — it is a one-line dependency injection using the helper that already
exists — but because of what their redness means. They are the only automated proof of the invariant
this entire workstream exists to protect: *a failed recovery query must never be treated as "no
history" and must never let a replacement shell displace a recoverable session.* The branch that
added the admission gate to protect that invariant simultaneously disabled the test that proves it,
and the delivery reported the suite as green. On a foundation intended to carry a future
agent-monitoring workstream, a silently-unguarded data-loss invariant is the expensive kind of debt.

Second priority: decide deliberately whether "fail closed" is allowed to mean "fail closed forever"
(P1-1 and P1-2). Right now that choice was made implicitly, and one of the two is even encoded in a
passing test.

---

## 10. Fair assessment

The production code here is better than the verification around it, and it deserves to be said plainly:

- **T3's capability-based bypass is genuinely well engineered.** A frozen object in a WeakSet, checked
  by identity *and* workspace *and* phase *and* attempt, with a `finally`-scoped lifetime, is stronger
  than the "distinct internal entry point" that was asked for. Single writer, verified by exhaustive
  grep. The HTTP-level contract test is the right test at the right layer.
- **T2's fail-closed decision is correct** and the accompanying report amendment is honest — it
  admits Phase 1 was wrong rather than quietly rewording, and it does not downgrade the severity.
- **T1's contract test** (mock host returning 91×27 for a 120×40 request) is exactly the regression
  asset the benchmark asked for, and it will catch any future re-introduction of request-echoing at
  the Worker layer.
- **Docs were updated with matching invariants** and the architecture gate genuinely passes.

The rejection is about the gap between "it works" and "it is proven to keep working". Fix P0-1,
address the two permanent-lock paths, and this line is a solid foundation.
