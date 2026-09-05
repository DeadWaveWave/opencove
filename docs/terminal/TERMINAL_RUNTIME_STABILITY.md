# Terminal Runtime Stability

This document records the runtime ownership and invariants behind geometry acknowledgement, PTY
spawn identity, and startup admission. It complements `MULTI_CLIENT_ARCHITECTURE.md`; it does not
move geometry authority out of the Worker Hub or make renderer state authoritative.

## Geometry acknowledgement

| State | Owner | Write entry | Restart source |
| --- | --- | --- | --- |
| Applied PTY rows and columns | ptyHost | post-resize PTY read-back; bounded Console observation on Windows | none |
| Windows observer process and pending queries | ptyHost | one shared child with validated private IPC | none |
| Windows resize order, readiness and cancellation | each ptyHost session | serialized resize, first native data dispatch, exit/kill | none |
| Resize verification outcome | ptyHost | `applied_verified` / `applied_unverified` response | none |
| Unconfirmed runtime mutation | local/Hub geometry transaction owner | before native resize; cleared only after verified commit | none |
| Canonical presentation geometry | Worker `PtyStreamHub` | runtime ACK followed by presentation commit | terminal recovery checkpoint |
| Local xterm geometry | renderer | canonical resize result | Worker presentation snapshot |

Invariants:

1. A verified runtime result reports the rows and columns read back from ptyHost, never the caller's
   proposal substituted as an acknowledgement.
2. The Worker commits and broadcasts only verified runtime geometry. On Windows, neither node-pty's
   cached `cols/rows` nor successful delivery to the ConPTY resize pipe proves application. The Host
   waits for node-pty readiness, resizes, then reads the actual Console until the requested grid is
   observed. A two-second budget includes queued work and is shorter than the renderer ACK deadline.
3. A malformed or missing remote acknowledgement is `runtime_failed`; it is distinct from the
   explicit non-failing `accepted_unverified` outcome.

Windows Console observation uses the narrow `node-pty` extension in `patches/node-pty@1.1.0.patch`.
`AttachConsole` is process-global, so attach/read/detach runs serially in a dedicated child, never in
the Host or app process. PIDs come only from active Host sessions. The observer has no resize entry;
querying does not inject terminal commands or output. Every query closes its Console handle and
detaches, and Host disposal or IPC disconnect terminates the child.

Session exit cancels waiting and queued mutations immediately. Every asynchronous boundary rechecks
cancellation, so an expired startup request cannot enter node-pty's deferred mutation queue. Observer
failure after mutation permits one bounded restart/read-back attempt. If confirmation still fails,
the transaction fails and preserves the last confirmed canonical geometry; that does not prove the
actual PTY rolled back. The renderer releases its output gate, invalidates its size cache and offers
an explicit sizing retry, including a retry to the previously confirmed dimensions.
The local and Hub committers also retain this uncertainty for their current presentation/session;
they must not optimize that retry away just because the request equals the last canonical size.
The renderer always submits a measured commit to that owner, even when its local cache matches;
the owner alone decides whether the runtime resize can safely be skipped.

Windows dependency installation builds node-pty from source to include the query extension. The
observer checks that native capability before its ready handshake. Developer/CI builds need MSVC C++
tools, Windows SDK and Spectre libraries; packaged users receive the native module. Windows CI and
release jobs use `windows-2022` with VS 2022 because pnpm 9's bundled node-gyp cannot discover VS 2026.
The additional observer is shared by all sessions in one Host and starts only when a Windows resize
needs it.

## Attach authority and live reattach

| State | Owner | Write entry | Restart source |
| --- | --- | --- | --- |
| Browser socket generation | Browser socket lifecycle | successful socket creation | none |
| Attach readiness | Browser attach coordinator | exact current-socket `attached` ACK | none |
| Client accepted geometry revision | renderer geometry coordinator | Worker snapshot/result | Worker presentation snapshot |
| Live frame proposal | renderer stable measurement | one controller `frame_commit` | recompute after attach |

Invariants:

1. A WebSocket open or sent hello does not authorize mutation. Write, resize and Agent re-entry wait
   for the current socket generation's exact session/role/authority acknowledgement.
2. Disconnect retires pending attach work and clears authority. A delayed prior-generation message
   cannot authorize the replacement connection.
3. Live reattach initializes the geometry coordinator from the snapshot's current geometry revision
   before beginning a measured commit. A controller may propose the stable frame once; a viewer only
   applies canonical geometry. Focus, input and ordinary attach are not resize observations.

## Client display calibration

| State | Owner | Write entry | Restart source |
| --- | --- | --- | --- |
| Shared display reference | persisted settings owner | explicit/automatic reference capture | SQLite app state |
| Local calibration | renderer-local calibration owner | conservative automatic/manual measurement | local client storage |
| Applied font metrics | terminal appearance owner | in-place appearance apply | current local calibration/defaults |

Invariants:

1. Calibration waits for hydrated settings, loaded fonts and stable layout, and is single-flight for
   one profile/reference/environment signature.
2. Only exact/close candidates that preserve reference rows and columns apply automatically. A stale
   or ambiguous result preserves current metrics and manual fallback.
3. Applying or invalidating local calibration does not remount xterm, replace its DOM, clear its
   buffer/selection or move its viewport. Any canonical grid change still requires an acknowledged
   Worker `appearance_commit`.
4. Disabling calibration changes font compensation only; basic window fitting still requires the
   same verified geometry transaction. Settings distinguish disabled/no record, saved/paused,
   unavailable and applied states. A shared reference alone is not a saved device adjustment, and
   diagnostics derive currently applied calibration from the calibration owner's projection.

## Spawn identity

| State | Owner | Write entry | Restart source |
| --- | --- | --- | --- |
| Host process instance identity | ptyHost | one random UUID before the ready handshake | none |
| Spawn launch identity | `PtyHostSupervisor` | one UUID per public `spawn` call | none |
| Launch identity to live session | ptyHost | atomic spawn registration | none |
| Confirmed child exit | `PtyHostSupervisor` | child-process `exit` event | none |

Invariants:

1. Ready establishes exactly one protocol version and host instance identity. Every later request,
   response and event carries that identity; a stale or wrong-instance envelope cannot resolve a
   request, emit a runtime event or mutate a host session.
2. Both endpoints validate complete private-protocol shapes before dispatch. Request/response
   discriminants and correlation IDs, strings, args/env, geometry, resize acknowledgements and
   foreground observations fail closed when malformed. Geometry is a positive integer no greater
   than 32767, matching the cross-platform Windows `COORD` ceiling.
3. A response must match the pending request ID, operation and expected session. Success and error
   shapes are exclusive; a spoofed response cannot settle unrelated work. If a pending spawn instead
   receives an operation response without a safe exact spawned-session identity, the exact host is
   quarantined because it may now own an unregistered PTY.
4. One launch identity maps to at most one live PTY in a host process; a duplicate request returns
   the already-created session identity.
5. A retry reuses the original launch identity and is allowed only when the previous host has a
   confirmed exit, or when no spawn request reached a host.
6. Ambiguous transport loss fails closed immediately. An observed exit clears the fence; otherwise
   a bounded deadline escalates termination to `SIGKILL` and retires only that exact child before a
   later spawn may create a replacement host.
7. Data and exit events that race ahead of a successful spawn response remain buffered under that
   session identity. Accepting the correlated response publishes buffered data first and exit last;
   `onExit` is therefore the output-completion boundary seen by Agent startup observation.
8. A successful spawn response that arrives after request ownership timed out is never activated. The
   supervisor immediately retires that exact session in the current host, so its output and exit
   cannot escape Hub/presentation ownership.
9. PTY cleanup only terminates sessions or the exact host child recorded by this supervisor. Startup
   never scans or signals machine-wide `node-pty` helpers whose ownership cannot be proven.
10. A controller-bound Agent re-entry may request an on-demand foreground observation through the
    same instance-fenced child protocol. The probe only publishes process evidence; it does not own
    PTY state, infer Agent activity from terminal text, or authorize command injection by itself. A
    weak Windows prompt-timeout observation is usable only beside an exact authenticated invocation
    exit; providers without that identity evidence fail closed.
11. Every asynchronous spawn consumer—Worker headless runtime, Desktop main-IPC runtime,
    multi-endpoint routing, and Agent launch registration—fences its post-response registration
    against `onExit`. If output completion wins that gap, neither Agent launch state, routing entries
    nor launch-artifact ownership may be installed; temporary artifacts are rolled back. If the
    registering owner was disposed instead, only the exact returned session may be retired.
12. Explicit session kill transitions active ownership to terminating ownership. Trailing data remains
    ordered and the first real session exit still reaches Hub, registration, and artifact-cleanup
    listeners. Silent tombstoning is reserved for an exact unowned late spawn, not an owned kill.
13. Browser and Desktop-to-Worker attach waits remain owned by the current session registration.
    Detach, exit, or owner disposal invalidates that ownership before a delayed socket connection or
    attach acknowledgement may publish authority or return a live session.
14. Desktop shutdown closes Local Worker restart admission before renderer flush, disconnects sync
    and PTY clients before stopping its owned Worker, and cannot launch a replacement through a
    disconnect callback. Worker shutdown freezes HTTP admission and drains every accepted handler
    independently of socket lifetime before disposing application owners. Stale Worker repair may
    terminate only a verified exact process tree and performs a bounded post-escalation exit wait
    before replacing its discovery authority.

The transport remains the supervisor-owned child IPC channel. The instance fence is lifecycle and
correlation integrity, not socket/network authentication; no parallel network authority is added.

## Startup admission

| State | Owner | Write entry | Restart source |
| --- | --- | --- | --- |
| Basic spawn admission | Worker `TerminalRuntimeAvailability` | startup scan, scoped repair after scan failure, shutdown | recomputed at startup |
| Recovery phase and monotonic epoch | Worker `TerminalRuntimeAvailability` | reconciliation start/completion, shutdown | recomputed from persisted workspace nodes |
| Workspaces requiring reconciliation | Worker startup scan | normalized persisted app state | SQLite app state |
| Recovery-only spawn capability | `session.prepareOrRevive` handler | current reconciliation scope only | none; unforgeable runtime scope |
| User-visible readiness message | renderer i18n | typed `terminal.runtime_not_ready` mapping | locale bundle |

Invariants:

1. A successful startup scan opens ordinary spawn admission, including for workspaces with persisted
   runtime nodes. Their `recoverySnapshot` remains `initializing` while recovery is pending. Waiting
   or failed old-node recovery cannot block new Terminal or Agent sessions in that same workspace,
   another workspace, or an unscoped launch.
2. Only the recovery handler owns the internal spawn capability. Its exact precondition is a live,
   current reconciliation scope for that workspace; public user/node spawn paths cannot create one.
3. Failed reconciliation makes its recovery snapshot `unavailable`; it does not revoke a ready
   Worker's basic spawn admission. Every successful recovery batch increases its recovery epoch.
   Shutdown closes both ordinary and recovery admission, and late completions cannot reopen it.
4. An incomplete or failed startup scan still blocks ordinary spawn. After scan failure, an explicit
   successful workspace reconciliation may authorize only that workspace. Workspace identity remains
   required for that exception; it cannot authorize another workspace or an unscoped launch.

Regression evidence covers controlled pending recovery at the HTTP boundary for both Terminal and
Agent creation, and Windows cold startup with new-session input before old-node recovery is released.
Existing per-node preparation deduplication and session registration fences continue to own process
identity and cleanup; opening admission does not replace or republish an old node's binding.
