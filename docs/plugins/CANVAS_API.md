# Canvas, terminal, and Agent host APIs

Use the same `host` object from backend `activate({ host })` and browser `api.host`.
A window is not required for backend commands. Preview host access is rejected.
These methods use OpenCove's node/session owners; they are not an unrestricted
control-surface bridge. Node.js permissions remain unchanged.

## Addressing and ownership

- Creation always requires `target: { projectId, spaceId? }`. Obtain exact IDs from
  `host.target.list()`. An active project is never assumed, even if only one exists.
- Without `spaceId`, the node belongs to the project canvas and uses the project's
  default mount. With it, creation uses that Space's mount and working directory.
- A missing, changed, unavailable, or invalid remote target fails. There is no
  fallback to the installation Worker's local directory.
- Existing nodes are addressed by exact `nodeId`; the owner resolves their current
  project and session binding. Methods never silently restart an exited session.
- Created windows belong to the user and are persisted. Closing a plugin view,
  disabling a plugin, or retiring its backend does **not** close these windows or
  stop their sessions. Call `nodes.close` explicitly when that is the intended action.
- Pending calls are generation fenced before dispatch and persistence. Work already
  dispatched can have effects; retiring a caller is not a transaction rollback.
- Concurrent canvas saves are merged by retrying only the node insertion plan
  (at most three attempts); a terminal or Agent process is not launched again.
  Target changes still fail. If a write result cannot be confirmed, the error
  includes the new node ID: inspect it before retrying. A possibly persisted
  window's session is retained rather than terminated.

## Canvas nodes

```js
const target = { projectId: selectedProjectId, spaceId: selectedSpaceId };
const created = await host.nodes.create({
  target,
  kind: 'note',
  title: 'Working notes',
  data: { text: 'Initial content' },
});
await host.nodes.update({
  nodeId: created.node.id,
  kind: 'note',
  data: { text: 'Updated content' },
});
await host.nodes.focus({ nodeId: created.node.id });
```

| Method | Input | Result |
| --- | --- | --- |
| `nodes.list` | `{ projectId, spaceId?, kind? }` | `{ projectId, spaceId, nodes, truncated }` |
| `nodes.get` | `{ nodeId }` | `{ node }` including kind-specific `data` |
| `nodes.create` | `{ target, kind, title?, frame?, data? }` | `{ revision, projectId, spaceId, node }` |
| `nodes.update` | `{ nodeId, kind, title?, frame?, data? }` | `{ revision, node }` |
| `nodes.focus` | `{ nodeId }` | canonical focus result; open renderers receive the focus event |
| `nodes.close` | `{ nodeId }` | `{ revision, projectId, spaceId, nodeId, runtimeCleanup }` |

`frame` is `{ x?, y?, width?, height? }` in canvas coordinates. Normal node minimum
sizes and placement rules apply. Creation supports `note`, `task`, `website`,
`terminal`, and `agent`. Updating supports `note`, `task`, and `website`; it does
not modify process state. Query/focus/close also support `plugin`, `document`,
`folder`, `image`, and `role` nodes. Unsupported creation or update kinds fail.

Kind-specific create/update data:

- note: `{ text }`
- task: `{ requirement, priority?, status?, tags? }`
- website: `{ url, pinned?, sessionMode?, profileId? }`
- terminal and Agent: prefer their named methods below.

Node summaries include `id`, `kind`, `title`, `projectId`, `spaceId`, `frame`,
optional `status` and `sessionId`. Lists are capped at 1,000 nodes and 1 MiB.
When `truncated`, narrow the project/Space/kind selection. Close persists removal
first, then cleans up its session, website surface, or plugin view leases. Closing
one plugin node does not stop the plugin's shared backend or other windows.

## Terminal and Agent windows

```js
const terminal = await host.terminals.create({ target, title: 'Checks' });
await host.terminals.write({ nodeId: terminal.node.id, data: 'pwd\n' });
const output = await host.terminals.read({ nodeId: terminal.node.id });
```

- `terminals.create({ target, title?, frame?, profileId?, shell?, command? })`
  creates a regular interactive terminal. Without `command`, the target Worker
  selects its default shell/profile. `command` is shell command text, not an argv
  array; a remote command requires an explicit target `shell`. For an executable
  plus argv and temporary progress/result, use `host.operations` instead.
- `agents.launch({ target, title?, frame?, prompt, provider?, model? })` launches a
  regular Agent window with the target Worker's supported provider/runtime rules.
  Supported provider IDs are `claude-code`, `codex`, `opencode`, `gemini`, `pi`,
  and `kimi` (availability depends on the target Worker).
- Both create methods return `{ revision, projectId, spaceId, node }`. Save
  `node.id`, not `sessionId`, for subsequent control.

Both `host.terminals` and `host.agents` expose:

| Method | Input | Behavior |
| --- | --- | --- |
| `get` | `{ nodeId }` | `{ node, session, agentState }`; session/state can be null |
| `read` | `{ nodeId }` | output tail with `{ nodeId, sessionId, output, truncated, fromSeq, toSeq }` |
| `write` | `{ nodeId, data }` | writes exact text; no automatic newline or escaping |
| `interrupt` | `{ nodeId }` | writes Ctrl-C to the current running session |
| `stop` | `{ nodeId }` | requests session termination, retaining the window |

Calls check that the node has the requested kind. Input is limited to 32 KiB and
uses the session's mutation queue, without stealing the UI's terminal geometry
control. The node-to-session binding is rechecked immediately before queued input.
Output is the latest 256 KiB, may include ANSI escape codes, and is not a complete
log. `agentState` is the latest observed Agent signal, not an acknowledgement that
an Agent finished a task. `stop` returns `{ nodeId, sessionId, requested: true }`;
observe subsequent state to confirm exit. `write`/`interrupt` return
`{ nodeId, sessionId, accepted: true }`.

Use [state observations](EVENTS.md) to refresh relevant UI instead of treating
terminal text or a single callback as durable state.
