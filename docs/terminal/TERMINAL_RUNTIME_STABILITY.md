# Terminal Runtime Stability

This document records the runtime ownership and invariants behind geometry acknowledgement, PTY
spawn identity, and startup admission. It complements `MULTI_CLIENT_ARCHITECTURE.md`; it does not
move geometry authority out of the Worker Hub or make renderer state authoritative.

## Geometry acknowledgement

| State | Owner | Write entry | Restart source |
| --- | --- | --- | --- |
| Applied PTY rows and columns | ptyHost | successful `resize` request | none |
| Canonical presentation geometry | Worker `PtyStreamHub` | runtime ACK followed by presentation commit | terminal recovery checkpoint |
| Local xterm geometry | renderer | canonical resize result | Worker presentation snapshot |

Invariants:

1. A successful runtime result reports the rows and columns acknowledged by ptyHost, never the
   caller's proposal substituted as an acknowledgement.
2. The Worker commits and broadcasts only the runtime-acknowledged geometry.
3. Missing or failed runtime acknowledgement is `runtime_failed`; it is not an accepted geometry.
