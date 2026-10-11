# Host API map

Use this inventory before choosing an API. The view receives
`window.opencovePlugin.host`; a Node backend receives `context.host` in
`activate(context)`. Both expose the same method names. A backend runs on its
installed Worker: direct Node APIs do not follow a selected remote project.

| Group | Methods | Contract |
| --- | --- | --- |
| `target` | `list`, `resolve` | [Explicit projects, Spaces and execution location](./TARGETS.md) |
| `filesystem` | `readDirectory`, `readText`, `stat`, `writeText`, `mkdir`, `rename`, `delete`, `watch`, `readWatch`, `unwatch` | [Routed files and sampled directory changes](./FILESYSTEM.md) |
| `operations` | `start`, `get`, `cancel` | [Bounded, cancellable process jobs](./TARGETS.md) |
| `nodes` | `list`, `get`, `create`, `update`, `focus`, `close` | [Persistent canvas objects](./CANVAS_API.md) |
| `terminals` | `create`, `get`, `read`, `write`, `interrupt`, `stop` | [Terminal windows and exact sessions](./CANVAS_API.md) |
| `agents` | `launch`, `get`, `read`, `write`, `interrupt`, `stop` | [Agent windows and exact sessions](./CANVAS_API.md) |
| `events` | `subscribe`, `poll`, `dispose` | [Sampled project, Space, node, session and preference changes](./EVENTS.md) |
| `preferences` | `get`, `set` | This plugin's declared preferences, below |

All methods return promises and accept one object, defaulting to `{}`. Use the
documented fields rather than passing arbitrary Control Surface commands through
the bridge. Requests and responses have a 2 MiB encoded JSON envelope limit;
individual operations can impose smaller limits. A 1 MiB text limit does not
override the envelope limit when JSON escaping increases its encoded size.

## Choosing the target

- Creation requires an explicit `projectId`, even when only one project exists.
  A `spaceId` further selects its directory and placement context.
- A saved node is addressed by `nodeId`. Session operations resolve that exact
  node's current session; they do not choose a recently active terminal.
- A backend command can run without any window. A window command requires the
  plugin's actual ready window and follows [command selection](./COMMANDS.md).
- Remote work follows the target mount using existing Worker routing. An offline,
  replaced or unsupported remote target fails; there is no local fallback.
- Menu and Sidebar host contexts identify the selected project explicitly.
  Context IDs are not filesystem paths or permission to mutate host internals.

## Preferences

```js
const values = await host.preferences.get()
await host.preferences.set({ key: 'compact', value: true })
```

The host derives plugin identity from the caller. There is no `pluginId` argument
for reading another plugin's preferences. Values use the declaration, validation
and durable owner described in [Host extensions](./HOST_EXTENSIONS.md#preferences).
Existing view shorthand `api.preferences.set(key, value)` remains available.
The `host` facade is unavailable in previews; the view shorthand uses isolated
in-memory preview preferences.

## Lifetime and ownership

| Resource | Owner | When its caller stops |
| --- | --- | --- |
| Canvas node / launched session | Workspace persistence and existing session service | Remains until explicitly closed or stopped |
| Plugin preference | Plugin storage owner | Persists; schema defaults are derived |
| Operation job | Calling view lease or backend generation | Cancelled and released; no durable background queue |
| File watch / event subscription | Calling view lease or backend generation | Released; handles cannot be reused by another caller |
| Sidebar section | Installed declaration and current project | Removed when unavailable; no background provider polling |

Host admission binds the request to the real view lease or backend generation.
Async mutation paths recheck that caller before dispatching writes, after waits
such as approval or target resolution. A request already handed to a provider or
remote Worker may still complete if its caller disconnects. This is not rollback.
Never automatically replay an uncertain mutation; inspect the target first.

File watches and lifecycle subscriptions compare bounded snapshots when polled.
They can coalesce changes and miss a create-then-remove between polls. They are
refresh signals, not an audit log or a lossless event stream. Respect the documented
poll interval, inspect truncation, and refresh authoritative state after a change.

## Declarative extensions

[Menus, preferences and themes](./HOST_EXTENSIONS.md) and [Sidebar trees](./SIDEBAR.md)
are manifest contributions. They use shared host rendering and dispatch. A plugin
cannot patch application DOM, internal React components or arbitrary host CSS
through these contracts. Node backends retain full OS permissions on their runtime
machine; this API is a supported integration boundary, not a security sandbox.

Unimplemented surfaces remain explicit in [the roadmap](./ROADMAP.md): durable jobs,
automatic remote deployment, automatic Skill directory management and native
client-device execution are separate work.
