# Terminal Runtime Stability

This document records the runtime ownership and invariants behind geometry acknowledgement, PTY
spawn identity, and startup admission. It complements `MULTI_CLIENT_ARCHITECTURE.md`; it does not
move geometry authority out of the Worker Hub or make renderer state authoritative.

## Geometry acknowledgement

| State | Owner | Write entry | Restart source |
| --- | --- | --- | --- |
| Applied PTY rows and columns | ptyHost | post-resize PTY read-back when synchronously observable | none |
| Resize verification outcome | ptyHost | `applied_verified` / `applied_unverified` response | none |
| Canonical presentation geometry | Worker `PtyStreamHub` | runtime ACK followed by presentation commit | terminal recovery checkpoint |
| Local xterm geometry | renderer | canonical resize result | Worker presentation snapshot |

Invariants:

1. A verified runtime result reports the rows and columns read back from ptyHost, never the caller's
   proposal substituted as an acknowledgement.
2. The Worker commits and broadcasts only verified runtime geometry. ConPTY resize is deferred, so
   its synchronous result is `accepted_unverified`: the operation was issued, but canonical
   presentation geometry remains unchanged until a verified observation exists.
3. A malformed or missing remote acknowledgement is `runtime_failed`; it is distinct from the
   explicit non-failing `accepted_unverified` outcome.

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
    disconnect callback. Stale Worker repair may terminate only a verified exact process tree and
    performs a bounded post-escalation exit wait before replacing its discovery authority.

The transport remains the supervisor-owned child IPC channel. The instance fence is lifecycle and
correlation integrity, not socket/network authentication; no parallel network authority is added.

## Startup admission

| State | Owner | Write entry | Restart source |
| --- | --- | --- | --- |
| Startup phase and monotonic epoch | Worker `TerminalRuntimeAvailability` | startup scan, recovery completion, shutdown | recomputed from persisted workspace nodes |
| Workspaces requiring reconciliation | Worker startup scan | normalized persisted app state | SQLite app state |
| Recovery-only spawn capability | `session.prepareOrRevive` handler | current reconciliation scope only | none; unforgeable runtime scope |
| User-visible readiness message | renderer i18n | typed `terminal.runtime_not_ready` mapping | locale bundle |

Invariants:

1. A workspace with persisted runtime nodes remains `initializing` until its complete
   `session.prepareOrRevive` operation succeeds; normal spawn entry points reject before then.
2. Only the recovery handler owns the internal spawn capability. Its exact precondition is a live,
   current reconciliation scope for that workspace; public user/node spawn paths cannot create one.
3. Failed reconciliation becomes `unavailable`, shutdown becomes `shutting-down`, late completions
   cannot reopen either state, and every successful return to `ready` increases the epoch. A user
   retry may reconcile that one unavailable workspace without globally opening admission for other
   workspaces after a startup scan failure.
4. Every workspace-owned spawn carries that workspace identity across the client boundary and gates
   on only that workspace's phase. A different workspace that is still initializing cannot block it.
