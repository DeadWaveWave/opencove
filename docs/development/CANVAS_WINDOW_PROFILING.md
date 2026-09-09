# Canvas and Window Performance Diagnosis

Use this workflow when canvas panning or desktop app switching stalls. The
profiler is an opt-in development tool, with no product runtime changes.

## References and scope

- [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance):
  measure the running application and correlate multiple processes before
  assigning a bottleneck. Main owns native windows; renderer JavaScript is
  only one possible source of a visible delay.
- [Electron contentTracing](https://www.electronjs.org/docs/latest/api/content-tracing):
  Main coordinates one recording across child processes after app readiness.
  Stop flushes asynchronously to a local file; capture/flush failures invalidate
  evidence. See the [TraceConfig contract](https://www.electronjs.org/docs/latest/api/structures/trace-config)
  for category selection and bounded buffers.
- [Chromium CPU profiler](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/):
  sampled stacks attribute renderer JavaScript costs; they do not measure
  WindowServer, native blocking, or actual presentation of another application.

The transferable rule is to correlate input, frame production, sampled stacks,
and native process activity. OpenCove's normal E2E environment disables background
throttling, so it cannot establish production app-switch performance. The
diagnostic runner restores background throttling on its window, records that
setting, and retains the test-fixture limitation in every report. It does not
automatically disable GPU acceleration, change React memoization, or tune input.

## State owners and invariants

| State | Owner and writes | Restart truth |
| --- | --- | --- |
| Fixture workspace and PTYs | Existing seed helper and runtime APIs, isolated temporary userData | Disposable fixture only |
| Canvas viewport | Existing renderer interaction owner; the probe sends real mouse events | Existing persistence owner |
| Observations | Injected renderer/Main probes, bounded arrays and paired cleanup | None; exported local report |
| Trace and CPU profile | Electron contentTracing and Chromium Profiler | Local artifact files |

1. Instrumentation never writes canvas positions, changes IPC/security contracts,
   or accesses installed application data. The intentional input changes only
   the disposable fixture through the existing interaction path.
2. Frame intervals spanning blur/hidden periods remain recorded separately.
   Foreground intervals above one second must not be discarded. Empty samples
   are unavailable, not zero cost.
3. A capture with errors, full buffers, dropped samples, or a pan with unchanged
   viewport is incomplete. A frame gap alone does not prove a CPU or GPU bottleneck.

## Preparation and capture

Use an isolated worktree and finish builds/tests before measurement. Coordinate
with other agents so no build or E2E runs overlap a capture. Record other host
load and stop only processes owned by the current experiment.

```bash
pnpm install --frozen-lockfile
pnpm build
OPENCOVE_PROFILE_SCENARIO=idle OPENCOVE_PROFILE_TERMINAL_COUNT=0 pnpm profile:canvas:window-stall
OPENCOVE_PROFILE_SCENARIO=pan OPENCOVE_PROFILE_TERMINAL_COUNT=1 pnpm profile:canvas:window-stall
OPENCOVE_PROFILE_SCENARIO=pan OPENCOVE_PROFILE_TERMINAL_COUNT=10 pnpm profile:canvas:window-stall
```

PowerShell uses the same runner with environment variables set beforehand:

```powershell
$env:OPENCOVE_PROFILE_SCENARIO = 'pan'
$env:OPENCOVE_PROFILE_TERMINAL_COUNT = '10'
pnpm profile:canvas:window-stall
```

The window is visible, focused, and set to the display's work area (not native
fullscreen). Capture takes 10 seconds after setup and a 3-second settle period.
The terminal stub is synthetic output, not a real agent workload. Each run has
an isolated profile that is removed on normal exit; interruption can leave
`opencove-canvas-profile-*` temporary directories for manual inspection.

Each report's `environmentIsolation` records redirected directory keys and
inherited host-variable names without dumping environment values. On Windows,
`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, and `PSModuleAnalysisCachePath` point
into the temporary fixture. This changes shell profiles, module-analysis cache
warmth, and user configuration relative to an installed application. `PATH`,
`SystemRoot`, `COMSPEC`, `HOMEDRIVE`/`HOMEPATH`, and `PSModulePath` remain inherited
when present; OS-account/registry/system-module/machine-cache state is not
isolated. Do not claim a hermetic Windows shell or real-user startup parity.

Controls:

| Environment variable prefix `OPENCOVE_PROFILE_` | Values / default |
| --- | --- |
| `SCENARIO` | `idle`, `pan`, `manual`; default `pan` |
| `TERMINAL_COUNT` | 0-30; default 1 |
| `SAMPLE_DURATION_MS` | 1000-120000; default 10000 |
| `OUTPUT_INTERVAL_MS` | 10-10000; default 100 |
| `OUTPUT_PAYLOAD_BYTES` | 1-10000; default 160 |
| `TRACE` | `0` disables trace/CPU profile for overhead comparison; default enabled |

Run idle and pan at 0, 1, and 10 terminals, at least three runs per cell,
interleaving cells to expose warmup or thermal drift. Repeat relevant cells
with `TRACE=0` to quantify profiler overhead. Keep resolution, DPR, display,
power state and other foreground apps fixed. Do not use a cross-machine absolute
FPS threshold as a merge gate.

## Real macOS app switching

```bash
OPENCOVE_PROFILE_SCENARIO=manual OPENCOVE_PROFILE_SAMPLE_DURATION_MS=60000 pnpm profile:canvas:window-stall
```

Wait for `[canvas-profile] manual` in the terminal. Alternate between OpenCove
and the affected application, first without panning and then with rapid panning.
Record the action count and perceived stall times alongside the artifacts.
Use an OS screen recording when actual presentation latency must be measured.
BrowserWindow focus events prove focus transitions, not another app's first
presented frame. Automated canvas pan and `window.blur()` cannot substitute for
this reproduction. Repeat with the installed release before concluding parity
with the fixture-based development build.

When native attribution is needed, the runner prints Main PID and records GPU
and renderer PIDs. During the capture, macOS can collect a bounded sample:

```bash
sample <main-pid> 10 -file /tmp/opencove-main.sample.txt
sample <gpu-pid> 10 -file /tmp/opencove-gpu.sample.txt
xcrun xctrace list templates
```

In Instruments, use Time Profiler/System Trace for the involved processes and
WindowServer, if permitted. Save this as a separate higher-overhead run.
Windows uses WPR/WPA CPU Usage/UI Delays; Linux uses `perf`/its compositor's
profiler subject to local permissions. Electron trace/CPU capture is shared
across all three OSes; native desktop latency claims require that OS's evidence.

## Artifacts and interpretation

Every run writes under ignored `artifacts/canvas-window-stall-profile/<timestamp>/`:

- `report.json`: revision, OS/CPU/Electron versions, display/bounds/GPU details,
  existing cross-platform process snapshot, raw frames/long tasks/focus events,
  autonomous 250ms Main timer and Electron process CPU samples, summaries/errors.
- `electron-trace.json`: Chromium trace, open locally in Chrome tracing or
  Perfetto. Category list and buffer utilization are in the report.
- `renderer.cpuprofile`: open in DevTools' JavaScript profiler for sampled stacks.
- `before.png`, `after.png`, `electron.log`: fixture and bounded startup output.

Main and renderer each use their own monotonic `startedAt`. Compare wall timestamps
as `timeOrigin + startedAt + at`, not raw offsets across processes. Chromium
trace timestamps have their own origin; align renderer `opencove-profile:*`
User Timing markers with matching report events. Timing alignment across clocks
is approximate; do not infer sub-millisecond causality from it.

Main timer delay is event-loop scheduling evidence, not pure CPU time. Electron
CPU metrics are interval process utilization, not per-thread stalls; the first
snapshot primes CPU sampling. Report GPU process metrics separately. The existing
process-tree snapshot captures Worker/PTY topology but is not a live Worker CPU
profile. A renderer CPU profile attributes JS; trace slices distinguish layout,
paint, raster, compositor and native task activity. Nested trace slice durations
must not be summed as exclusive time.

Correlate repeated foreground gaps with overlapping tasks/stacks. High GPU CPU or
WindowServer activity alone is insufficient to blame a function. If local runs
do not reproduce the reported >1-second cross-app delay, report that limitation
and retain the manual/native follow-up instead of presenting an optimization.

Raw traces, command lines and screenshots can contain local paths and content;
keep them local and review before sharing. Do not commit run snapshots. Commit
the reusable script/tests/workflow and place dated findings in the PR or local
report. This tool is separate from the sanitized in-app issue-report bundle.

## Verification and risk

Unit tests cover configuration bounds, missing data, retained >1-second frames,
background separation, and probe serialization in fresh Main/renderer VM
contexts without runner closure dependencies. Runtime smoke must show a changed pan viewport,
nonempty Main/renderer samples, parseable nonempty trace/profile, and paired
probe/process cleanup. Full repository gates follow DEVELOPMENT.md before delivery.
No product behavior changes are part of this diagnosis workflow.
