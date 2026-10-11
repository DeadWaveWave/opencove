# Bounded state observations

`host.events` observes current project, Space, node, session, and own-plugin
preference state. It is available to a real window and to the plugin backend.
Preview access is rejected.

This is a sampled change feed, **not a reliable event log**: changes between polls
may be coalesced, a create followed by a delete can disappear between samples, and
there is no history replay. Re-read the authoritative host API after an indication.

```js
const subscription = await host.events.subscribe({
  projectId: selectedProjectId,
  types: ['node', 'session'],
});
try {
  const batch = await host.events.poll(subscription);
  if (batch.changes.length || batch.truncated) {
    const current = await host.nodes.list({ projectId: selectedProjectId });
    // Render current state.
  }
} finally {
  await host.events.dispose(subscription);
}
```

- `subscribe({ projectId, types? })` requires an existing exact project ID and
  returns `{ subscriptionId }`. Supported types: `project`, `space`, `node`,
  `session`, `preferences`; omitting types observes all five. Subscription
  establishes a baseline and emits no initial changes.
- `poll({ subscriptionId })` returns
  `{ subscriptionId, sequence, changes, truncated }`. Each change contains
  `{ type, id, change: 'created' | 'changed' | 'removed' }`. For project/Space/node,
  ID is the entity ID. Session changes use the **node ID** for follow-up with
  `terminals.get` or `agents.get`. Preferences use the caller's plugin ID; read
  current values with `host.preferences.get({})`.
- `dispose({ subscriptionId })` returns `{ disposed: true }` and invalidates it.
  Further calls fail; dispose is not a durable subscription record.

Limits are four subscriptions per calling owner and 32 per Worker. A window and
its backend are different owners. A subscription cannot be polled or disposed by
another view or backend. Each poll returns at most 100 change indications. With
`truncated: true`, some indications were omitted and the baseline has advanced:
refresh authoritative state; do not expect another poll to replay the remainder.
Projects larger than 10,000 entities of an observed type are rejected.

Only one poll may be pending on a subscription. Sampling is limited to once per
250 ms; earlier polls return an empty batch with the current sequence. A loop
should wait at least 250 ms. Two minutes without polling expires the lease.
Sequence increments when a sample detects changes and stays unchanged for empty
batches. It is local to this subscription, not a global persistence revision.

Leases live in memory. View closure, backend retirement, plugin disable/update/
uninstall, or Worker restart invalidates them. There is no automatic resume or
replay. Dispose when a view no longer needs updates; retry by subscribing anew only
while its owner remains active. No polling timer runs in the host for idle leases.
Preferences scope is always the caller's plugin, derived by the host rather than a
plugin ID in the payload.
