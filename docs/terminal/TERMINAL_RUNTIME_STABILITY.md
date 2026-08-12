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
| Spawn launch identity | `PtyHostSupervisor` | one UUID per public `spawn` call | none |
| Launch identity to live session | ptyHost | atomic spawn registration | none |
| Confirmed child exit | `PtyHostSupervisor` | child-process `exit` event | none |

Invariants:

1. One launch identity maps to at most one live PTY in a host process; a duplicate request returns
   the already-created session identity.
2. A retry reuses the original launch identity and is allowed only when the previous host has a
   confirmed exit, or when no spawn request reached a host.
3. Ambiguous transport loss fails closed immediately. An observed exit clears the fence; otherwise
   a bounded deadline escalates termination to `SIGKILL` and retires only that exact child before a
   later spawn may create a replacement host.

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
