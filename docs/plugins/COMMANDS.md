# Plugin commands, windows and skills

Use `opencove plugin list` and `opencove plugin details <id>` to discover each
installation's `commands` and `skills`. Their declarations come from the active
immutable package, so editing the source has no effect until a successful reload.
There are no dynamically registered top-level CLI commands.
These window, command and Skill operations reject unsupported CLI options or
Control Surface input fields instead of silently ignoring them. Plugin-wide
commands reject project, node and view selectors; window selection and placement
belong only to window operations.

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
A plugin may provide both. Packages can also contribute preferences and themes
without a window; see [Host extensions](./HOST_EXTENSIONS.md).
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

CLI backend commands receive `pluginId` in `commandContext`; host-menu invocations
can also supply a validated explicit selection, documented in
[Host extensions](./HOST_EXTENSIONS.md). Use activation's `dataDirectory` for
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
existing window. Creating any new window requires `--project`, including when
only one project exists. Each UI client has its own active project, which the CLI
does not infer.
It returns the durable node identity and requests focus. A singleton's existing
node is reused across projects. `windows` lists those durable nodes and their
current view IDs/readiness; `--project` filters the listing.

Use this plugin-specific listing for view IDs, readiness and client selection,
and the plugin's declared read/status commands for its own state. Generic node
queries, focus and close also support plugin windows; generic creation and
updates remain limited to their documented node kinds. See
[nodes and sessions](./CANVAS_API.md) for each operation's contract. Read back the
exact node and project after an uncertain result before attempting another mutation.

`--node` selects an existing node and cannot be combined with `--space` or a
Control Surface placement `anchor`. Project, space and anchor are creation
destinations, not requests to migrate an existing singleton. An existing singleton
is reused across projects without being moved. Check the returned
`projectId` and `created: false` for the actual existing location. Without an
explicit node selector, a requested creation project is not a relocation request.

Each listed window includes its `savedTitle` and effective `title`. Each view also
includes an effective `title` and, after `api.setTitle`, its reported `contentTitle`.
A user-pinned name takes precedence in every effective title. Otherwise, the
window summary uses the views' title only when all listed views agree; different
client titles remain visible per view and the summary falls back to `savedTitle`.
Without views, the saved title is used. Content titles are observations attached
to view leases, not persisted names or evidence of command readiness. They expire
with the lease; a disconnected lease can remain during the reconnection grace
period. Preview titles never appear in this listing.

For a singleton window command, the host opens the missing node or focuses its
existing node as needed. Opening a missing node also requires `--project`.
It then waits up to 10 seconds for a connected UI and command
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

### Required operational instructions for Skill authors

A contributed Skill must guide an agent through the complete workflow, including
when its intended OpenCove instance is stopped. Include these instructions in
`SKILL.md`, with the plugin's actual commands and readback checks:

1. **Keep the intended runtime identity.** Identify the user's existing Worker
   profile or explicit remote endpoint before operating. Keep that selection on
   every command: `OPENCOVE_USER_DATA_DIR` restricts regular CLI discovery to a
   known local profile; local lifecycle commands also take `--user-data`. Do not
   silently select another running instance, create a fresh profile, or reinstall
   the plugin elsewhere when the intended instance is unavailable.
2. **Recover that same instance through public tools.** Consult `opencove --help`
   and this build's offline `opencove plugin guide`. For a known local profile,
   inspect `opencove worker status --user-data <profile> --pretty`; if stopped,
   help start or reopen that same runtime using the documented CLI/launcher and
   its existing configuration. Verify its status and installed plugin again.
   For an unavailable remote Worker, help restore its connection instead of
   launching a local replacement. If the intended profile, endpoint or startup
   settings are unknown, resolve that uncertainty before starting anything.
3. **Discover an explicit project before creation.** Run `opencove project list
   --pretty` on the selected runtime. Match a returned project ID to the user's
   request, resolving ambiguous names with the user. Every new plugin window
   requires `--project`, even with one project. A client's visible/active project
   and the CLI's working directory do not select it. If no project exists, guide
   the user to create one in the intended UI, then list projects again.
4. **Resolve node and view identity.** Read `plugin details <id>` and `plugin
   windows <id>` before choosing a window command. Reuse a known node with
   `plugin open <id> --node <node-id>`. An existing singleton is shared across
   projects; inspect the returned project rather than creating a replacement or
   moving it. Multiple-instance commands always require `--node`. When several
   views are ready, resolve the intended client and pass its current `--view`;
   do not choose the first view, broadcast, or infer the target from a title.
5. **Handle readiness without changing targets.** Backend commands need no UI;
   window commands need the intended Desktop/Web UI and its registered handler.
   If a view is closed, stale or unready, list it again and help reopen/focus the
   same intended node. Do not secretly open another node or switch Workers merely
   to obtain a successful response. Report when a deliberately created node
   remains saved but its command could not run.
6. **Execute and read back.** Await the result, then use the plugin's declared
   read/status command or another documented observation on that same target to
   verify the requested state. `plugin windows` can verify identity and reported
   titles; it cannot prove that unrelated content was saved or media is playing.
   Provide the exact readback command and expected fields in the Skill. If the
   plugin cannot verify a promised result, add that capability or state the limit.
7. **Recover uncertain results without replay.** A timeout or disconnect may
   occur after an effect. Inspect state first; never automatically repeat the
   mutation, change a stale view ID to another client's ID, or report success
   solely because a request was sent. Explain any remaining uncertainty.

Verify the Skill as a consumer with the intended Worker initially stopped, with
more than one project, with ambiguous node/view choices, and with a failed or
uncertain command. The authoring startup example creates a development profile;
it is not a fallback that an operational Skill may use to replace the user's
existing instance.
