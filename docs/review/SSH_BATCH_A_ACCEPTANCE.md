# SSH Batch A (S1–S4) — Independent Acceptance Review

**VERDICT: REJECT**

Two blocking defects, both independently reproduced by this reviewer:

1. **P0** — `endpoint.updateManagedSsh` bypasses the topology store's serialized write queue and
   persists a pre-`await` snapshot. A mount created while the update is in flight is **permanently
   destroyed** in both memory and `worker-topology.json`. This directly violates the batch's own
   headline invariant ("update preserves existing mount bindings").
2. **P0** — `pnpm pre-commit` **does not pass** when run the way `DEVELOPMENT.md` mandates
   (`git add` first). It fails at `format-check:staged` on 9 files, all introduced by this branch.
   The claimed "exit 0" was produced against an empty staging area, where every `*:staged` gate is
   a no-op.

Everything else in the batch is good work — the domain extraction, contract validation, runtime
signature invalidation, i18n and test coverage are genuinely solid, and scope discipline is clean.
The verdict is REJECT solely because finding 1 is silent durable-data loss and finding 2 means the
declared verification gate was never actually executed.

- Reviewer: independent pi acceptance gate (Phase 3)
- Worktree: `/Users/shihaojie/orca/workspaces/opencove/ssh-experience`, branch `DeadWaveWave/ssh-experience`
- Range: `origin/main..HEAD` = `f36a1d48..0f6c7c9d`, 9 commits, 35 files, +2230/−322
- Spec basis: `docs/research/SSH_EXPERIENCE_ORCA_BENCHMARK.md`

---

## 1. Verification I personally reproduced

Every row below is a command I ran in this worktree, not a claim I accepted.

| # | Command | Real outcome |
| --- | --- | --- |
| V1 | `pnpm check` (tsc) | **PASS**, exit 0 |
| V2 | `pnpm lint` (oxlint) | **PASS** — 0 warnings, 0 errors, 1858 files |
| V3 | `pnpm ui:style-check` | **PASS**, no raw-color findings |
| V4 | `pnpm test -- --run` | **PASS** — 1701 passed, 6 skipped, 431 files, 84.9s |
| V5 | `pnpm test:terminal-recovery:native` | **PASS** — 3/3 |
| V6 | `pnpm arch:doc-sync` | **PASS** — "Architecture doc sync check passed." |
| V7 | `pnpm arch:check --severity error` | **PASS** — 0 errors, 0 warnings, 1143 files |
| V8 | `pnpm arch:results:check` | **PASS** — "Architecture result verification passed." |
| V9 | `pnpm arch:test` | **PASS** — 16/16 |
| V10 | `pnpm test:e2e` (full, 16.7 min) | **FAIL overall** — 264 passed, **1 failed**, 47 skipped |
| V11 | `pnpm format:check` | **FAIL** — 9 files unformatted, **all 9 touched by this branch** |
| V12 | `pnpm format-check:staged` with the branch staged | **FAIL** — same 9 files |

### V11/V12 — the pre-commit claim does not hold

`DEVELOPMENT.md` is explicit: *"运行 `pnpm pre-commit` 前，必须先 `git add` 本次改动"*. Every
`*:staged` script reads `git diff --cached --name-only`
(`scripts/check-format-staged.mjs:6-25`), so on a clean tree they inspect **zero files** and pass
vacuously. That is how "exit 0" was obtained.

Reproducing the gate correctly — detached worktree at HEAD, `git reset --soft origin/main` to stage
all 35 files:

```
$ git worktree add --detach /tmp/sshrev/stagecheck HEAD && cd /tmp/sshrev/stagecheck
$ git reset --soft origin/main
staged files: 35
$ pnpm line-check:staged     # PASS (no file >500 lines)
$ pnpm naming-check:staged   # PASS
$ pnpm secret-check:staged   # PASS
$ pnpm format-check:staged
[prettier] src/app/main/controlSurface/handlers/topologyHandlerPayloads.ts is not formatted.
[prettier] src/app/main/controlSurface/topology/managedSshEndpointRuntime.ts is not formatted.
[prettier] src/app/main/controlSurface/topology/topologyEndpointUpdate.ts is not formatted.
[prettier] src/contexts/settings/presentation/renderer/settingsPanel/EndpointRemoveDialog.tsx is not formatted.
[prettier] src/contexts/settings/presentation/renderer/settingsPanel/EndpointsRegisterDialog.tsx is not formatted.
[prettier] src/contexts/topology/domain/endpointRemovalImpact.ts is not formatted.
[prettier] tests/unit/contexts/controlSurface.topologyHandlers.spec.ts is not formatted.
[prettier] tests/unit/contexts/managedSshEndpointRuntime.spec.ts is not formatted.
[prettier] tests/unit/contexts/topologyStore.endpointRemoval.spec.ts is not formatted.
 ELIFECYCLE  Command failed with exit code 1.
```

I verified these files are Prettier-clean on `origin/main` (checked out at `/tmp/sshrev/mainchk`:
*"All matched files use Prettier code style!"*), so the branch introduced all 9. `pnpm pre-commit`
therefore **cannot reach** `check` / `test:staged` / `test:e2e:pre-commit` in a correct run.

The worst instance is a JSX block wrapped in a new conditional without re-indenting the children —
`EndpointsRegisterDialog.tsx:101-122`, where the two `<button>` elements sit at the old depth
inside the new `{mode === 'create' ? (` wrapper. That is also a readability regression, not just a
whitespace nit.

---

## 2. Findings

| Sev | Issue | File:line | Evidence | Suggested fix |
| --- | --- | --- | --- | --- |
| **P0** | `updateManagedSshEndpoint` bypasses `writeQueue` and persists a stale snapshot; a mount created during the update is destroyed in memory **and** on disk | `topologyStore.ts:176-193` (esp. `:192` `persistTopologyFile` vs `:100` `persistQueued`) | Reproduced twice — see §3 | Route the update through `persistQueued`; build `nextTopology` **after** the dispose `await`, or mutate `topology.endpoints` in place like every other mutator |
| **P0** | `pnpm pre-commit` fails at `format-check:staged` on 9 branch-introduced files; the claimed pass came from an empty stage | 9 files, see V12 | Command output above | `pnpm format` + amend; re-run `pre-commit` with changes staged |
| **P1** | Invariant 2 ("changed params stop the old tunnel before rebuild") is **not** proved end-to-end for the update path. The runtime-level test proves signature invalidation, but nothing proves the store's dispose→persist→re-prepare sequence rebuilds with the new config | `topologyStore.ts:185-193`; `topologyHandlers.ts:69-77` | `topologyStore.managedSshUpdate.spec.ts:85-90` asserts dispose was *called with old ssh*; no test asserts the tunnel is rebuilt with new params | Add an integration test: update → assert `disposeEndpoint` then `prepareEndpoint` ordering and that the new tunnel spawns with the new host/port |
| **P1** | `CONTROL_SURFACE.md` states the update "invalidates the previous tunnel **before** the new configuration is prepared", but the store disposes the tunnel **before** the durable write. A persist failure leaves a killed tunnel plus the old config — doc and code disagree on ordering semantics | `CONTROL_SURFACE.md:111-114` vs `topologyStore.ts:185-193` | Read both | Either persist-then-dispose, or amend the doc to state the tunnel is killed even on persist failure |
| **P2** | `expectedMountCount` is optional, so the concurrency guard is **fail-open by default**. The CLI omits it entirely | `topology.ts:60`; `topologyStore.ts:218-227`; `src/app/cli/commands/multiEndpoint.mjs:91` | `normalizeRemoveEndpointPayload` accepts `null`/`undefined` (probed: both → `{endpointId}`) | Acceptable for non-interactive callers, but document it; consider requiring it for the interactive contract |
| **P2** | `handleSave` silently no-ops when `dialogMode === 'edit'` but `editingEndpointId` is null — falls through and **creates a duplicate endpoint** instead of updating | `EndpointsSection.tsx:174-186` | Code read; unreachable today since `openEditWindow` always sets both | Make mode+id a single discriminated state: `{kind:'create'} \| {kind:'edit', endpointId}` |
| **P2** | Light/dark parity is incomplete: the invalid-port error state is captured **dark-only** | `settings.endpoints-managed-ssh-crud.spec.ts:154-158` | Only `managed-ssh-edit-{dark,light}` and `managed-ssh-remove-{dark,light}` have both | Add a light capture of the invalid-port state |
| **P2** | Dead fixture destructure added purely to satisfy a lint rule | `settings.endpoints-managed-ssh-crud.spec.ts:52` | `browserName: _browserName` is never used | Drop it, or use `test('...', async ({}, testInfo) =>` |
| **P2** | N+1 in overview listing: `getEndpointRemovalImpact` is awaited per endpoint | `endpointHealthService.ts:299` | Cheap (in-memory) today, but scales with endpoints × mounts | Resolve impact once from a single snapshot |
| **P2** | `CHANGELOG.md` `[Unreleased]` not updated despite user-visible changes | — | `git diff --name-only origin/main..HEAD \| grep -i changelog` → empty | Per `DEVELOPMENT.md` this is due once a PR number exists — follow-up, not a blocker |

---

## 3. The P0 data-loss race, reproduced

`updateManagedSshEndpoint` is the **only** mutator that does not use `persistQueued`. Compare:

- `registerEndpoint` `:133`, `registerManagedSshEndpoint` `:155`, `removeEndpoint` `:243`,
  `createMount` `:378`, `removeMount` `:399`, `promoteMount` `:454` → all `await persistQueued()`
- `updateManagedSshEndpoint` `:192` → `await persistTopologyFile(topologyPath, nextTopology)`

`nextTopology` is built at `:182-188` — **before** the `await` on
`disposeManagedSshEndpointRuntime` at `:185-190` — and captures the *old* `topology.mounts` array
reference. Any mount added during that await is absent from `nextTopology`, and `topology =
nextTopology` at `:193` then discards it from memory too.

The await window is wide in production. `disposeManagedSshEndpointRuntime` is wired to
`managedSshRuntime.disposeEndpoint` (`controlSurfaceHttpServer.ts:96`), which awaits any in-flight
`prepare` (up to a 7.5s `waitForCondition`, `managedSshEndpointRuntime.ts:223`) and then
`stopTunnel`, which waits SIGTERM → 2.5s → SIGKILL (`:146-164`). So the window is **seconds**, and
`mount.create` is reachable concurrently from the AddProjectWizard and ProjectMountManager.

### Probe 1 — mount created during dispose is destroyed

```ts
// gate dispose to model the real SIGTERM -> 2.5s -> SIGKILL window
disposeManagedSshEndpointRuntime: async () => { await disposeGate }

const updating = store.updateManagedSshEndpoint({ endpointId, host: 'new.example.com', remotePort: 42_000 })
await new Promise(r => setImmediate(r))
const createdMount = await store.createMount({ projectId: 'project-a', endpointId, rootPath: '/remote/project' })
// mid-flight assertion PASSES: the mount is durably on disk here
releaseDispose(); await updating
```

Result:

```
DURABLE mounts after update: []
IN-MEMORY mounts after update: []
AssertionError: expected [] to include 'f5549012-981b-4c75-9e4c-15ccc0e6d10b'
```

The mount was durably persisted, then silently erased by the update. Not recoverable on restart —
`worker-topology.json` no longer contains it.

### Probe 2 — same loss via a queued write

Update parked in dispose, `createMount` issued concurrently, then both settled:

```
DURABLE host after save: new.example.com
DURABLE mount count: 0
AssertionError: expected [] to have a length of 1
```

The endpoint edit is saved correctly, and the mount is gone. From the user's perspective: *"I
edited the SSH port and my remote project lost its mount."*

Both probes were run as temporary specs and **removed**; the worktree is clean
(`git status --short` → empty).

### Why this is P0, not P1

The batch's stated invariant is that update preserves `endpointId`, `credentialRef` **and mount
bindings** (`SSH_EXPERIENCE_ORCA_BENCHMARK.md`, Phase-2 invariant 3). The existing test
(`topologyStore.managedSshUpdate.spec.ts:76-81`) only proves this in the quiescent case. The store
already owns a `writeQueue` precisely to serialize durable writes; the new code is the single
mutator that opts out of it. This is silent, permanent, durable-truth loss — exactly the
`DEVELOPMENT.md` "Data Integrity" / "Concurrency & Race" class.

**Note:** with no dispose hook at all the race did not reproduce (probe removed), so this is
specifically about the managed-SSH path where the hook is wired — i.e. the real one.

---

## 4. Invariant-by-invariant proof status

| # | Invariant | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `endpointId` / `credentialRef` never change on update | **Proved by test** | `topologyEndpointUpdate.ts:38-47` spreads `...input.current` and rejects mismatched id at `:27`; `topologyStore.managedSshUpdate.spec.ts:73-84` asserts `credentialRef` and the secrets file are byte-identical |
| 1b | Mount bindings survive update | **DISPROVED under concurrency** | Quiescent case proved (`:76-81`); §3 shows concurrent case destroys the mount |
| 2 | Changed connection params stop the old tunnel before rebuilding | **Partially proved** | Runtime level proved: `managedSshEndpointRuntime.ts:174-179` signature compare → `stopTunnel`, tested at `managedSshEndpointRuntime.spec.ts` "stops the old tunnel before preparing changed connection parameters" (asserts `firstTunnel.kill` once, port 41003→41004). Store level **code-only**: `topologyStore.ts:185` disposes, `topologyHandlers.ts:71-74` re-prepares, but no test covers that sequence |
| 3 | Failed update leaves durable config untouched | **Proved by test** | Two tests: validation failure (`:93-112`, byte-for-byte compare, dispose not called) and dispose failure (`:114-139`). Caveat: on dispose failure the *tunnel* is already dead — durable config is intact, runtime is not. Doc/code mismatch noted as P1 |
| 4 | An illegal port string cannot produce a successful registration | **Proved by test, defence in depth** | Domain: `managedSshPort.ts:6-22`, tested for `''`/`'   '`/`'1'`/`'22'`/`' 65535 '`/`'abc'`/`'0'`/`'70000'`/`'2 2'`/`'22.5'`/`'-1'`. Renderer: `EndpointsSection.tsx:61-65` gates submit, tested in `endpointsSection.spec.tsx` over 4 illegal inputs. IPC: `topologyHandlerPayloads.ts:76-90` re-parses at the boundary, contract-tested in `controlSurface.topologyManagedSshUpdate.spec.ts:59-78` for both register and update. E2E: `settings.endpoints-managed-ssh-crud.spec.ts:147-153` asserts error text + disabled submit |
| 5 | The delete dialog's displayed count equals what is actually unbound | **Proved by test** | Same pure function feeds both display and deletion: `endpointRemovalImpact.ts:11-22` → `topologyStore.ts:216` (guard) and `:230-231` (actual filter, keyed on the same `mountIds`). `topologyStore.endpointRemoval.spec.ts:20-49` asserts `impact.mountCount === result.removedMountCount === 2`; `:51-79` proves fail-closed. E2E `:185-187` asserts the rendered string |

Note on invariant 5: the deletion now filters by `mountId` (`:231`) rather than by `endpointId` as
before. That is the correct change — it guarantees the deleted set is exactly the counted set.

---

## 5. Flake investigation (item B)

**Conclusion: the failure I observed is a genuine pre-existing flake, unrelated to this change.**
But the implementer's numbers do not match mine, and the difference matters.

My run: **264 passed, 1 failed, 47 skipped** (16.7 min). Claimed: "262 passed / 47 skipped / 3
unrelated retry-pass flakes".

The single failure:

```
✘ 172 tests/e2e/workspace-canvas.selection.spaces.drag-selected.spec.ts:272
    › Workspace Canvas - Selection (Spaces) › resizes selected space from edge hitbox (16.9s)
    Timeout 15000ms exceeded while waiting on the predicate
```

Evidence it is unrelated and pre-existing:

1. **No endpoint/topology surface.** `grep -nE "endpoint|topology|managedSsh|mount"` on that spec
   returns nothing. It seeds a canvas space and drags an edge hitbox.
2. **The branch never touched that area.**
   `git log origin/main..HEAD -- tests/e2e/workspace-canvas.selection.spaces.drag-selected.spec.ts src/contexts/workspace/`
   is empty.
3. **Passes in isolation, repeatedly.** Single test: pass in 3.5s. Whole file, 3 consecutive runs:
   `2 passed (6.0s)`, `2 passed (10.9s)`, `2 passed (5.6s)`. Classic load/timing sensitivity — a
   15s poll budget missed under full-suite pressure at position 172/312.

On the count discrepancy: `playwright.config.ts:84` resolves retries to `isCi ? 1 : 0`, so locally
retries are **0** and a flake is a hard failure. The "3 retry-pass flakes" phrasing implies the
implementer ran with retries enabled (CI mode or `OPENCOVE_E2E_RETRIES`), where Playwright reports
retried tests as `flaky` rather than `passed` — which plausibly explains 262-vs-264. I could not
reproduce their exact numbers.

The substantive point stands: **the suite does not go green locally on default settings**, and the
new `settings.endpoints-managed-ssh-crud.spec.ts` itself passed cleanly (6.8s) on the first attempt
in my run. The batch did not introduce the failure, but "everything passes" is not accurate either.

---

## 6. Preserved strengths and scope discipline

### Preserved strengths (item G) — all four confirmed intact

| Strength | Status | Evidence |
| --- | --- | --- |
| `recommendedAction` modelling | **Preserved and extended** | 16 references in `endpointHealthService.ts`; every new `buildOverview` call site passes it alongside the new `dependentMountCount` |
| Token persistence at `0o600` | **Preserved through the refactor** | Moved to `topologyPersistence.ts:8`; the temp file is created with `mode: 0o600` *before* `rename`, so the mode survives. I verified empirically with a throwaway spec: both `worker-topology.json` and `worker-endpoint-secrets.json` are `600` after register **and** after update. The atomic write is a genuine improvement over the previous in-place `writeFile` |
| `inFlightPrepare` coalescing | **Preserved and improved** | `managedSshEndpointRuntime.ts:92,292-299,352-358`. Now signature-aware: same signature coalesces, changed signature drains then re-runs. Strictly better than before |
| `requestCounterRef` stale-response discard | **Untouched** | `useEndpointOverviews.ts:53,70,82,88,94` — the file is not in the diff at all |

### Scope discipline (item H) — clean

- **No `ssh2` dependency.** Not in `package.json`.
- **`pnpm-lock.yaml` and `package.json` untouched.** `git diff origin/main..HEAD` on both → empty.
- **No S5/S6 leakage.** Grepping the diff for `scheduleReconnect|reconnectAttempt|backoff|health.changed|askpass|identityFile|passphrase|proxyJump|importConfig` matches **documentation lines only** (the Phase-1 benchmark report describing Orca). Zero code matches.
- **No unrelated files.** All 35 files fall in topology/endpoints/settings-endpoints/i18n/tests/arch-baseline.
- **Architecture baseline refresh is legitimate.** The `+41 filesAnalyzed / +9 warnings` diff looked suspicious, so I checked `origin/main` in a separate worktree: `pnpm arch:results:check` there **fails** with *"Architecture audit results are stale."* The baseline was already stale on main; this branch regenerated it correctly, and `arch:results:check` now passes here.

### Architecture conformance (item E) — clean

- Validation lives in `src/contexts/topology/domain/` (`managedSshPort.ts`, `endpointRemovalImpact.ts`) as pure functions with no runtime imports. Presentation calls them (`EndpointsSection.tsx:8,56-57`), does not reimplement them.
- The same domain parser is reused at the IPC boundary (`topologyHandlerPayloads.ts:15,86`) — genuine reuse, not duplication.
- Control Surface contract registered at `topologyHandlers.ts:65-81` with `validate:` wired, and documented at `CONTROL_SURFACE.md:54,111-114`.
- `arch:doc-sync`, `arch:check`, `arch:results:check`, `arch:test` all pass.

### i18n (item F) — complete

`en.settingsPanel.endpoints.ts` and `zh-CN.settingsPanel.endpoints.ts` both gained `portInvalid`,
`remove.{title,description,impact_one,impact_other}`, `edit.{title,help}` — structurally identical.
Plural suffixes are supported by the runtime (`i18n/index.ts:54-56`). All `common.*` keys used by
the new dialogs (`edit`, `save`, `saving`, `remove`, `removing`, `cancel`, `error`) exist in both
locales. No hardcoded user-facing strings in the new components.

### UI evidence (item I)

Four screenshots attached via `testInfo.attach`: `managed-ssh-edit-{dark,light}`,
`managed-ssh-remove-{dark,light}` — light/dark for edit and remove dialogs, with an explicit
`data-cove-theme` assertion (`spec:44`). Gap: invalid-port state is dark-only (P2 above). No new
colors were introduced — the new UI reuses `cove-window__error`, `cove-window__action--danger`,
`cove-window__action--ghost`, all defined in `src/app/renderer/styles/cove-window.css:174,223,263`.
`pnpm ui:style-check` passes.

### Risk-checklist items that came out clean (item D)

- **IPC validation on the new command** — thorough. `normalizeUpdateManagedSshEndpointPayload` (`topologyHandlerPayloads.ts:176-209`) rejects non-records, requires `endpointId`/`host`/`remotePort`, and re-parses ports via the domain function. I probed `expectedMountCount` with `'3'`, `true`, `{}`, `[]`, `NaN`, `1.5`, `-1` — all correctly rejected; `null`/`undefined` correctly accepted as absent.
- **Renderer never writes durable truth** — the renderer only invokes commands; the topology store remains the sole durable writer.
- **Runtime failure never corrupts durable config** — `topologyHandlers.ts:70-77` deliberately swallows a `prepareEndpoint` failure after a successful durable write, with a comment explaining why. Contract-tested at `controlSurface.topologyManagedSshUpdate.spec.ts:101-124`. This is the right call and correctly keeps runtime observation out of durable state.
- **Resource lifecycle** — `stopTunnel` (`:136-165`) nulls the process handle before killing, clears the SIGKILL timer on exit, and the exit handler guards with `if (record.process !== child) return` (`:198-200`) against stale-listener writes.
- **Async gap on dispose** — `disposeEndpoint` (`:362-372`) drains both in-flight maps before stopping.

---

## 7. Residual risk / what to watch in production

1. **The P0 race generalises beyond mounts.** The same pre-`await` snapshot at `topologyStore.ts:182-188`
   also captures `topology.endpoints`. A `registerEndpoint` landing during the update window would
   be dropped identically. Fixing this by routing through `persistQueued` fixes both; fixing only
   the mounts symptom would not.
2. **Tunnel is killed before the durable write succeeds.** If `persistTopologyFile` fails (disk
   full, EPERM), the user keeps the old config but loses the live tunnel until the next
   prepare/repair. Recoverable, but the error message will say the save failed while connectivity
   also silently dropped.
3. **`localPort` instability is correctly documented but unenforced.** The audit
   (`SSH_EXPERIENCE_LOCAL_PORT_AUDIT.md`) is accurate — I verified no production caller outside
   `managedSshEndpointRuntime` reads `localPort`; the only other reader is
   `endpointHealthService.ts:268-279`, which reads a fresh snapshot. Nothing prevents a future
   caller from caching it. Consider a lint rule or a narrower return type.
4. **In-flight remote operations during an edit.** Editing an endpoint kills the tunnel immediately.
   Any open PTY/WebSocket on that endpoint will fail rather than drain. Acceptable, but user-visible
   — worth a confirmation hint in the edit dialog if support reports appear.
5. **Guard is fail-open for non-interactive callers.** The CLI path
   (`multiEndpoint.mjs:91`) removes endpoints without `expectedMountCount`, so the concurrency guard
   protects only the settings UI.
6. **Flaky E2E masking.** `workspace-canvas.selection.spaces.drag-selected.spec.ts:272` fails under
   full-suite load with a 15s poll budget. Pre-existing and out of scope here, but it will keep
   costing reviewer time and eroding "the suite is green" as a signal.

---

## 8. What to do next

Blocking, in order:

1. Route `updateManagedSshEndpoint` through `persistQueued`, and build the next topology **after**
   the dispose await. Add a regression test that creates a mount during a gated dispose and asserts
   it survives — probe 1 in §3 can be lifted directly.
2. Run `pnpm format`, amend, then run `pnpm pre-commit` **with changes staged** and paste the real
   output.

Then re-request review. The remaining P1/P2 items are reasonable follow-ups and should not block a
second pass once the two P0s are closed.

**Counts: 2 × P0, 2 × P1, 6 × P2.**

For the record: the domain-function extraction, the three-state port parser reused across all four
layers, the fail-closed `expectedMountCount` guard, the signature-aware tunnel invalidation, the
atomic `rename` persistence, and the byte-for-byte "config unchanged on failure" tests are all
above the bar for this repo. The rejection is narrow and mechanical, not a judgement on the design.

---
---

# Re-review (round 2)

**VERDICT: ACCEPT-WITH-FOLLOWUPS**

Both round-1 P0s are genuinely closed. I re-ran every gate myself against a **proven non-empty
staging area (36 files)**, and I verified the new regression tests actually fail against the
pre-fix source — they are real tests, not decoration. Both round-1 P1s and **all six** P2s are
fixed or consciously declined with a stated reason.

I found **one new P2** introduced by the remediation (a memory/disk divergence on the update path
that did not exist pre-fix), and I have a specific answer on the write-queue blast-radius question.
Neither blocks the batch.

- Reviewer: independent pi acceptance gate (Phase 5, round 2)
- Range reviewed: `f36a1d48..5b67f5f8`, 10 commits, **36 files**, +2547/−340
- Remediation commit: `5b67f5f8 fix(endpoints): serialize managed SSH updates`
- `origin/main` advanced during the branch's life: `f36a1d48` → `72b7b244` (#316)

---

## R2.1 — Round-1 findings: status

| # | Round-1 finding | Sev | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Update bypasses `writeQueue`, persists a pre-`await` snapshot, destroys concurrent mounts | P0 | **FIXED** | `topologyStore.ts:165-178`; `topologyManagedSshUpdate.ts:39-49` |
| 2 | `pnpm pre-commit` fails at `format-check:staged` on 9 branch files | P0 | **FIXED** | `format-check:staged` exit 0 on 36 staged files; `prettier --check .` exit 0 repo-wide |
| 3 | Invariant 2 not proved end-to-end (dispose→persist→re-prepare) | P1 | **FIXED** | `controlSurface.topologyManagedSshUpdate.spec.ts:144-224` |
| 4 | `CONTROL_SURFACE.md` doc/code ordering mismatch | P1 | **FIXED** | `CONTROL_SURFACE.md:111-118` rewritten |
| 5 | `expectedMountCount` fail-open, undocumented | P2 | **FIXED (documented)** | `CONTROL_SURFACE.md:120-122` |
| 6 | `handleSave` can create a duplicate when mode=edit but id=null | P2 | **FIXED** | `EndpointsSection.tsx:15,39,171-175` — discriminated union, exactly as suggested |
| 7 | Invalid-port state captured dark-only | P2 | **FIXED** | `settings.endpoints-managed-ssh-crud.spec.ts:158,189` — both themes |
| 8 | Dead `browserName: _browserName` destructure | P2 | **FIXED** | `spec:52,56` — now genuinely used to namespace the temp dir |
| 9 | N+1 `getEndpointRemovalImpact` per endpoint | P2 | **FIXED** | `endpointHealthService.ts:297-299` + `resolveEndpointRemovalImpacts` (`endpointRemovalImpact.ts:11-29`), single pass |
| 10 | `CHANGELOG.md` not updated | P2 | **DECLINED, legitimately** | Due once a PR number exists per `DEVELOPMENT.md`; still unwritten |

### P0-1: verified deeper than "the direct call is gone"

I checked the four things that would make a superficial fix:

1. **Is the topology re-derived from LIVE state after the await?** Yes. The pre-`await` snapshot is
   gone entirely. `topologyManagedSshUpdate.ts:39` re-invokes `findCurrentEndpoint(endpointId)`
   *after* `await options.disposeRuntime?.(...)` (`:32`), and the record handed to `commit` is
   rebuilt from that fresh read at `:45-49`. `commit` then does a **read-modify-write on the live
   array** (`topologyStore.ts:172-174` — `topology.endpoints = topology.endpoints.map(...)`),
   so it can only ever replace one element of the current array. There is no reachable path,
   including the error paths, that writes a stale whole-file object: `persist()` takes
   `topology` as a **default argument evaluated at flush time** (`topologyStore.ts:86-88`), so the
   queued write always serialises live state.
2. **Does it re-validate the endpoint after the async gap?** Yes — `:40-44` throws
   `common.invalid_input` ("not found after runtime disposal") if the endpoint vanished. That is a
   distinct, greppable message from the pre-dispose check at `:18-22`.
3. **Does the new test genuinely fail pre-fix?** **Yes — and harder than claimed.** I checked out
   the pre-fix tree `0f6c7c9d`, copied in *only* the new spec file, and ran it:

   ```
   FAIL  preserves a mount created while the previous tunnel is being disposed
         AssertionError: expected [] to deep equally contain ObjectContaining{…}
   FAIL  fails cleanly when the endpoint is removed during runtime disposal
         AssertionError: promise resolved "{ endpoint: {…} }" instead of rejecting
   Tests  2 failed | 3 passed (5)
   ```

   Post-fix: **14 passed** across the four related specs. The implementer reported Red as
   1-failed/3-passed; the reality is **2-failed/3-passed**. The first failure is the exact
   data-loss symptom I reported in round 1 (`expected [] to contain the mount`). These tests
   would catch a regression.
4. **Can I still break it?** I wrote three fresh interleaving probes; **all pass**:
   - *update racing `registerEndpoint`* — the concurrently-registered endpoint survives on disk
     **and** the update still lands. This was the generalisation I flagged in round-1 §7.1; it is
     closed by the same fix.
   - *update racing update (same endpoint)* — durable result is internally consistent
     (host+port from the same update, never a mix), exactly one endpoint record. Last-write-wins,
     which is acceptable for a full-replacement contract.
   - *update racing remove* — rejects cleanly, endpoint stays removed. This is the branch's own
     new test and it holds.

   All probes were temporary and have been deleted; `git status --short` shows only this
   untracked `docs/review/` directory.

### P0-2: gates re-run by me, with a proven non-empty stage

Detached worktree at `5b67f5f8`, `git reset --soft f36a1d48` (the merge-base):

```
staged files: 36        (git diff --cached --name-only | wc -l)
ACMR-filtered:  36      (what check-format-staged.mjs actually reads)
```

| Gate | Real outcome |
| --- | --- |
| `pnpm format-check:staged` | **PASS**, exit 0 — *this is the gate that failed round 1* |
| `pnpm line-check:staged` | PASS, exit 0 |
| `pnpm secret-check:staged` | PASS, exit 0 |
| `pnpm naming-check:staged` | PASS, exit 0 |
| `pnpm ui:style-check` | PASS, exit 0 |
| `npx prettier --check .` (whole repo) | **PASS** — "All matched files use Prettier code style!" |
| `pnpm check` (tsc) | PASS, exit 0 |
| `pnpm lint` (oxlint) | PASS — 0 warnings, 0 errors, 1859 files |
| `pnpm test -- --run` | **PASS — 1705 passed, 6 skipped, 431 files**, exit 0 (was 1701) |
| `pnpm test:terminal-recovery:native` | PASS — 3/3 |
| `pnpm arch:doc-sync` | PASS |
| `pnpm arch:check --severity error` | PASS — 0 errors, 0 warnings, 1144 files |
| `pnpm arch:results:check` | PASS |
| `pnpm arch:test` | PASS — 16/16 |
| `pnpm test:e2e settings.endpoints-managed-ssh-crud.spec.ts` | PASS — 1 passed (8.6s) |

All 9 files I named in round 1 are now Prettier-clean. I did not re-run the full 16-minute E2E
suite; the pre-existing `workspace-canvas.selection.spaces.drag-selected` flake documented in
round-1 §5 is unchanged by this remediation (that area is still untouched by the branch).

### The "prettier exits 1 only because origin/main advanced" claim — verified, and it is genuine

I scrutinised this because it is exactly the shape of an explained-away failure. It holds up:

- `origin/main` moved from `f36a1d48` to `72b7b244` ("Persist sidebar and arrange preferences
  across restarts", #316) **after** this branch was created.
- `git diff --name-only origin/main..HEAD` (two-dot) yields **49** paths; `merge-base..HEAD` yields
  **36**. The extra 13 are #316's files appearing as reverse-deltas, including paths that do not
  exist on this branch (e.g. `tests/e2e/ui-preferences.persistence.spec.ts`). Piping that list into
  `prettier` makes it exit 1 on a **missing file**, not on a formatting violation.
- The decisive counter-evidence: **`npx prettier --check .` over the entire working tree passes,
  exit 0**, and `format-check:staged` — the gate `pre-commit` actually runs — passes on all 36
  staged files. There is no real formatting failure hiding behind the branch-drift explanation.

---

## R2.2 — The write-queue poisoning question

**Verdict: the mechanism is genuinely pre-existing, but routing update through the queue DID widen
the blast radius. It should not block this batch; it should be tracked as a real follow-up.**

I proved each half rather than reasoning about it.

**The mechanism is real.** `persistQueued` (`topologyStore.ts:96-99`) is:

```ts
writeQueue = writeQueue.then(async () => await persist())
```

There is no `.catch`. Once `writeQueue` is a rejected promise, every later `.then(onFulfilled)`
skips its callback and forwards the *original* rejection. The write is never attempted again, and
the caller receives a **stale error describing the first failure**.

Probe (branch HEAD): make the user-data dir unwritable, issue a write, restore writability, issue
another write.

```
STEP1 register:                        OK
STEP2 write with dir read-only:        REJECTED:EACCES
STEP3 write AFTER dir writable again:  REJECTED:EACCES     <- wedged
STEP4 durable mounts on disk:          []
POISONED = true
```

Every subsequent write is dead for the process lifetime.

**It is pre-existing.** `origin/main` has the byte-identical pattern at
`topologyStore.ts:105-107`. My first `origin/main` probe *appeared* clean — but only because main
persists with an in-place `writeFile`, which still succeeds in a read-only **directory**. Re-probing
main with the failure mode that actually bites it (chmod the topology **file** to `0o400`):

```
MAIN2 failed-write: REJECTED:EACCES | MAIN2 after-recovery: REJECTED:EACCES
MAIN2_QUEUE_POISONABLE = true
```

So: pre-existing, and it already affects the six mutators that were always queued.

**But the blast radius did widen, in two distinct ways:**

1. **Update is now a poison *source*.** Pre-fix it called `persistTopologyFile` directly, so a
   failed update could not wedge anything else. Post-fix a failed update poisons the shared queue
   for every future write. I measured this directly — `UPDATE_POISONS_QUEUE = true`.
2. **Update is now a poison *victim*** — a previously-wedged queue blocks updates too.

This is the correct trade. Bypassing the queue is what caused the P0 data loss; being wedged is
loud and recoverable-by-restart, whereas silent durable-truth loss is neither. Consistency with the
other six mutators is worth more than a special case. But "pre-existing" is not "harmless": the
consequence is *all* durable writes dead until restart, with users seeing a stale error message.

The fix is small, separable, and should be its own change (it touches every mutator, so it is
out of scope for batch A):

```ts
const persistQueued = async (): Promise<void> => {
  const next = writeQueue.then(async () => await persist(), async () => await persist())
  writeQueue = next.catch(() => undefined)   // never leave the queue rejected
  return await next
}
```

---

## R2.3 — New findings introduced by the remediation

| Sev | Issue | File:line | Evidence |
| --- | --- | --- | --- |
| **P2 (new)** | The update path now mutates in-memory state **before** the durable write, so a persist failure leaves memory and disk **diverged**. Pre-fix this specific path was persist-then-commit and did *not* diverge | `topologyStore.ts:172-176` | Probe below |
| **P2 (new, doc)** | `CONTROL_SURFACE.md:114-116` says that if the durable write fails "the old durable configuration remains authoritative". True **of the file**, but the running process serves the *new* config from memory until restart. The doc as written implies the old config is what callers observe | `CONTROL_SURFACE.md:114-116` vs `topologyStore.ts:172-176` | Same probe |

Probe — dir unwritable, update, then read back:

```
update result:   REJECTED
IN-MEMORY host:  new.example.com
ON-DISK   host:  old.example.com
DIVERGED = true
```

Why this is P2 and not higher: the durable file is untouched, so round-1 invariant 3 ("failed
update leaves durable config untouched") still holds and restart is fully correct. And this is the
**store-wide pattern** — `registerEndpoint:129-133`, `createMount`, `removeMount` etc. all mutate
memory then `await persistQueued()`. The remediation made update *consistent* with its six
siblings rather than inventing a new hazard. It is still a genuine behavioural regression on this
one path relative to pre-fix, so it belongs in the record; the honest fix is to roll back the
in-memory mutation when `persistQueued` rejects, across all mutators, together with the
poisoning fix above.

Nothing else regressed: no test was weakened or deleted, the two lint-driven cosmetic edits
(`managedSshEndpointRuntime.ts:237` blank line, `spec:52` fixture) are inert, and the unit count
moved **up** 1701 → 1705.

---

## R2.4 — Preserved strengths and scope, re-checked

| Item | Status |
| --- | --- |
| `recommendedAction` modelling | Intact — 16 references in `endpointHealthService.ts`; survived the N+1 refactor |
| Token persistence at `0o600` | Intact — `topologyPersistence.ts:8`, mode set on the temp file before `rename` |
| `inFlightPrepare` coalescing | Intact — 6 references, signature-aware behaviour unchanged |
| `requestCounterRef` stale-response discard | Untouched — `useEndpointOverviews.ts` still absent from the diff |
| No `ssh2` dependency | Confirmed — 0 matches in `package.json` |
| `package.json` / `pnpm-lock.yaml` untouched | Confirmed — empty diff vs merge-base |
| Batch-A only, no S5/S6 leakage | Confirmed — 0 code matches for `scheduleReconnect\|backoff\|askpass\|identityFile\|passphrase\|proxyJump\|importConfig` in `src/`+`tests/` added lines |
| File sizes under the 500-line gate | `topologyStore.ts` 491 (was 502 — the extraction brought it back under), `topologyManagedSshUpdate.ts` 50, `endpointRemovalImpact.ts` 41 |
| E2E visual evidence | Now 6 captures: `managed-ssh-{edit,remove,invalid-port}-{dark,light}` — full parity |

The `topologyManagedSshUpdate.ts` extraction is a genuine design improvement, not just a bug patch:
it makes the dispose→revalidate→commit sequence a single readable unit with the store's mutation
injected as `commit`, which is why the race is now testable at all.

---

## R2.5 — Remaining follow-ups for a human to track

1. **Write-queue rejection poisoning** (P1-grade, pre-existing, store-wide). One failed persist
   wedges *all* durable writes until restart and reports a stale error. Widened by this batch.
   Fix `persistQueued` to never leave the queue in a rejected state. **Highest-value item here.**
2. **Memory/disk divergence on persist failure** (P2, new on this path, store-wide pattern). Roll
   back the in-memory mutation when `persistQueued` rejects, and tighten
   `CONTROL_SURFACE.md:114-116` to say what callers observe *in-session*, not just on disk.
3. **`CHANGELOG.md` `[Unreleased]`** — still owed once the PR number exists. Correctly declined for
   now.
4. **Stop-before-persist recovery** — a successful tunnel stop followed by a failed write leaves the
   endpoint reachable-but-disconnected until a manual repair. Now documented
   (`CONTROL_SURFACE.md:114-116`); real, bounded, user-recoverable.
5. **In-flight remote operations are killed on edit** — unchanged from round 1; open PTYs on the
   endpoint fail rather than drain. Acceptable, worth a UI hint if support reports appear.
6. **`expectedMountCount` fail-open for CLI callers** — documented rather than enforced. Fine.
7. **Pre-existing E2E flake** `workspace-canvas.selection.spaces.drag-selected.spec.ts:272` —
   unrelated to this branch, still erodes "the suite is green" as a signal.
8. **Rebase onto `72b7b244`** before merge; the branch is one commit behind and the two-dot diff is
   misleading until then.

---

**Round-2 counts: 0 × P0, 0 × P1, 2 × new P2 (both non-blocking), 8 follow-ups.**

Round 1 had 2 × P0, 2 × P1, 6 × P2. Both P0s and both P1s are closed; five of six P2s are closed
and the sixth (CHANGELOG) is legitimately deferred. The implementer's reporting was accurate and,
in the case of the Red test result, *understated* — they claimed 1 failing pre-fix test where there
are 2. The remediation is real work, correctly targeted, and it left the batch's existing strengths
intact. Shipping this with the write-queue poisoning tracked as the top follow-up is the right call.
