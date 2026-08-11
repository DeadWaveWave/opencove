# Managed SSH `localPort` caller audit

Scope: Phase-2 SSH S1-S4 changes. Product decision: the loopback port may change whenever a managed
SSH tunnel is replaced; consumers must resolve a connection at the operation/reconnect boundary and
must not persist or cache `localPort` as durable endpoint state.

## Result

No caller outside `managedSshEndpointRuntime` reads or persists `localPort`. The topology store
exposes only `resolveRemoteEndpointConnection(endpointId)`, which resolves current managed access and
then calls `managedSshRuntime.resolveConnection`.

Audited call sites:

- filesystem mount operations resolve immediately before each remote invoke;
- topology ping/home/read-directory handlers resolve immediately before each remote invoke;
- PTY spawn and agent/session launch handlers resolve immediately before forwarding;
- `session.finalMessage` stores `endpointId + remoteSessionId`, then re-resolves the endpoint before
  its remote query;
- `RemotePtyEndpointProxy` stores `endpointId`, not a connection; every socket connect/reconnect and
  recovery request calls `resolveEndpointOrThrow`, which re-enters topology resolution;
- mount creation's best-effort remote approval resolves at the time of that approval.

Conclusion: no production caller caches the runtime loopback port across tunnel replacement. An
already-open HTTP/WebSocket operation may finish or fail on its resolved connection, while its next
operation or reconnect re-resolves and receives the new port. This is the intended runtime boundary.
