# CLI event stream v1

`GET /events?stream=agent&format=cli-v1&selection=<JSON>[&after=<cursor>]`
uses the existing authenticated SSE endpoint. Send credentials in the Authorization
header. Query-token authentication is rejected for this representation. Legacy agent
SSE, workspace sync and PTY transport keep their existing representations.

`features.eventStreamV1` advertises the installed stream adapter. No global protocol
version bump is needed. The first record is `stream.ready`, followed by original
registry publications or a terminal `stream.gap`. Runtime schemas and bounded opaque
cursor encoding live in `src/shared/contracts/dto/eventStream.ts`.

The registry owns the single retained history and sequences; contextual subscription
exposes immutable event-time and previous bindings before filtering. The HTTP adapter
owns serialized enrichment, scope departure detection, queue limits and revocation.
No await separates the final liveness check from a transport write. Revocation directly
disposes the adapter, removes subscription membership and discards queued and late
results. Previously submitted bytes cannot be retracted. No command or state mutation
is introduced. Existing read authority for agent.list/get and node.get applies;
resource filters do not create a new isolation boundary.

The CLI owns selection resolution, whole-command cancellation and the last stdout
checkpoint. A checkpoint/count advances only after the write callback succeeds; a
false write result additionally requires drain before consumption continues. Server
safe cursor means submitted to transport; client safe cursor means a complete stdout
write. Neither means downstream processing or durable state acknowledgement.

See [Events](EVENTS.md) for the public contract, recovery and exit codes.
