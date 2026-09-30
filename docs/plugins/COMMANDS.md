# Plugin commands, windows and skills

Use `opencove plugin list` and `opencove plugin details <id>` to discover each
installation's `commands` and `skills`. Their declarations come from the active
immutable package, so editing the source has no effect until a successful reload.
There are no dynamically registered top-level CLI commands.

## Declare contributions

```json
{
  "contributes": {
    "commands": [
      {
        "id": "status",
        "title": "Read status",
        "description": "Read the plugin's saved status without opening a window.",
        "target": "plugin"
      },
      {
        "id": "select",
        "title": "Select an item",
        "description": "Select an item in a particular plugin window.",
        "usage": "--params '{\"itemId\":\"example\"}'",
        "target": "window"
      }
    ],
    "skills": [
      {
        "id": "plugin-workflow",
        "description": "Use this plugin's commands for its documented workflow.",
        "path": "skills/plugin-workflow/SKILL.md"
      }
    ]
  }
}
```

A command requires `id`, `title`, `description`, and `target`; `usage` is optional
human/agent guidance, not a separate argument parser or validation schema. Command
and skill IDs must be unique within their respective lists. They use lowercase
letters and digits, with dots or hyphens separating segments, up to 80 characters.
Each list permits at most 100 entries. Titles are at most 120 characters; command
descriptions and usage strings are at most 2,000 characters; skill descriptions
are at most 1,024 characters. Validate domain parameters in your handler.

`target: "plugin"` requires a `main` backend and runs without a window.
`target: "window"` requires `view` and runs in an actual browser document.
A plugin may provide both. A package needs at least one view, command or skill.
Omit `view` entirely for command-only or skill-only packages; a missing view cannot
have `preview`, window commands, or enabled window creation contributions.

## Backend commands

```js
export function activate(context) {
  return {
    async runCommand(commandId, params, commandContext) {
      if (commandId !== 'status') throw new Error(`Unknown command: ${commandId}`)
      return { pluginId: commandContext.pluginId, available: true }
    },
    async dispose() {
      // Release only resources owned by this backend instance.
    },
  }
}
```

`commandContext` contains only `pluginId`. Use activation's `dataDirectory` for
private data. Neither the caller's working directory nor an active project is
inferred. `opencove plugin run <id> status` works without a connected Desktop or
Web UI, provided the Worker is running and the plugin is enabled and healthy.
Plugin-target commands reject node, view and project selectors.

Existing `invoke(method, params, viewContext)` remains available for calls from
your own view. It is not the CLI entry and is not exposed by inventing a view lease.

## Browser commands

Register a single handler in the actual page:

```js
const api = window.opencovePlugin
const context = await api.ready
const unsubscribe = api.onCommand(async (commandId, params) => {
  if (commandId !== 'select') throw new Error(`Unknown command: ${commandId}`)
  if (!params || typeof params.itemId !== 'string') {
    throw new Error('itemId must be a string')
  }
  await selectItem(params.itemId)
  return { nodeId: context.nodeId, selectedItemId: params.itemId }
})
```

`onCommand` returns an unsubscribe function. Registering another handler replaces
the previous one; unsubscribing an old handler does not remove its replacement.
The view is command-ready only after parent initialization and handler registration.
Previews are never CLI command targets.

Return JSON or `void`, synchronously or from a promise; `void` becomes JSON `null`.
Throw or reject for failure. Both targets reject unsupported JSON members such as
nested `undefined`, functions, `BigInt`, and non-finite numbers. Requests are bounded
to 1 MiB and replies to 2 MiB of UTF-8 JSON; leave room for the command envelope.
The host limits pending calls and gives each dispatch 30 seconds.

A browser handler can manipulate its page and use the SDK. It must await the
actual operation before reporting success. For media, await the browser's playback
operation and propagate failures, including autoplay restrictions. A successful
dispatch alone is not proof of audible playback or continuing playback after close.

## Window identity and selection

`view.instances` controls durable canvas node identity:

| Value | Opening behavior | Window-command target |
| --- | --- | --- |
| `multiple` (default) | Each open creates a node unless an existing `--node` is selected | Explicit `--node` is always required |
| `single` | Reuses one node across all projects on the connected Worker | Uses that node; can open it when absent |

Old manifests default to `multiple`. Closing a singleton removes that canvas node;
a subsequent open creates a fresh node. Plugin-private storage remains separate.
If conflicting singleton nodes already exist, the host reports the conflict rather
than silently deleting or selecting one.

```sh
opencove plugin open <id> --project <project-id>
opencove plugin windows <id>
opencove plugin run <id> select --node <node-id> --params '{"itemId":"example"}'
opencove plugin run <id> select --node <node-id> --view <view-id> --params '{"itemId":"example"}'
```

`open` accepts `--project` and `--space` for placement, or `--node` to select an
existing window. Without an explicit project, creation uses the active project.
It returns the durable node identity and requests focus. A singleton's existing
node is reused across projects. `windows` lists those durable nodes and their
current view IDs/readiness; `--project` filters the listing.

For a singleton window command, the host opens the missing node or focuses its
existing node as needed, then waits up to 10 seconds for a connected UI and command
handler. A headless Worker cannot execute browser commands. Multiple-instance
commands do not guess a node from focus or from the number of visible windows:
open a node explicitly and pass its ID.

Creating a node and executing its browser command are separate steps. If no UI
connects or the handler does not become ready, the newly saved node remains and
the command fails without dispatch; a later request reuses that node. An explicit
stale `--view` fails before creating any node. A plugin reload or disable during
selection aborts the request instead of silently switching to another generation.

One node can render on Desktop and Web clients simultaneously. Those documents
are distinct execution targets: when more than one is ready, pass `--view` from
`plugin windows`. View IDs are transient and change on remount/reload. Commands
are delivered to one document and never broadcast. A focus request does not prove
that a particular client is ready or that an action succeeded.

## Failures and lifecycle

Undeclared commands, disabled/error installations, wrong node/view selections,
unready handlers and ambiguous clients fail before dispatch. Disconnect, close,
disable, reload, uninstall and shutdown reject affected pending calls. Late
replies from an old connection or generation do not satisfy new calls.

The host does not retry commands. A timeout or connection loss may happen after
an action took effect; inspect current state before deliberately issuing it again.
Raising CLI `--timeout` changes the caller's waiting deadline, not the 30-second
dispatch deadline or the 10-second window readiness deadline. `run` defaults to
a 60-second CLI timeout so those host-side errors can return normally.

Plugin activation and replacement follow [Runtime ownership](./RUNTIME.md).
Candidate activation is not a data transaction and must not perform irreversible
side effects or incompatible migrations on the shared private data directory.

## Skills

```sh
opencove plugin skill <id> plugin-workflow
```

The query returns `{ pluginId, skill, content, path, installPrompt }`. `skill.path`
is package-relative; `path` is an absolute path to the installed immutable
`SKILL.md` on the connected Worker. It may not be accessible from a remote CLI
machine. `content` is the author's unmodified text, limited to 128 KiB.

The file must exist at installation and end with `SKILL.md`. Author it using the
[Agent Skills format](https://agentskills.io/specification): YAML frontmatter with
`name` and `description`, followed by Markdown instructions. Keep the skill's name
consistent with its containing directory; retain any referenced resources beside
it. OpenCove uses manifest metadata for discovery and preserves the skill body.

Reading a skill works for disabled installations and does not start a special
backend, execute its instructions, or modify agent configuration. `installPrompt`
is guidance for deliberate installation. Choose the target agent's skills directory
and copy the skill directory with its resources only when that action is wanted.
There is no implicit global or project skill installation.
