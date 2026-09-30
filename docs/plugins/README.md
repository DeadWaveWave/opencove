# OpenCove plugins

This is the guide shipped with the OpenCove build that returned it. Start with
`opencove plugin guide`; it prints this README's absolute path and the documentation
directory. The command works offline and does not start an app or Worker.

**This build can install an independent local plugin directory.** A plugin can
supply an HTML view, commands, skills, an optional Node backend, README, icon and
interactive preview. Its window uses OpenCove's normal header, drag, resize,
collapse and close behavior. Command-only and skill-only packages need no window.
You do not edit or rebuild OpenCove to install or reload a plugin.

Before designing a view, read [OpenCove plugin design system](./VISUAL_DESIGN.md): host
boundaries, layout, typography, theme colors, controls and a copyable CSS baseline.
It gives defaults without making every plugin use the same content layout.

Start implementation with [Authoring and verification](./AUTHORING.md), then copy the runnable
[Hello Clock example](./examples/hello-clock/README.md) into your own directory.
[API reference](./API.md) contains the complete development API supported here.
Do not infer additional APIs from the [Git Board roadmap](./GIT_BOARD_MVP.md).

## Commands

Except for `guide`, these commands connect to the running OpenCove control surface
and return JSON. The existing `--endpoint`, `--token`, `--timeout` and `--pretty`
options work with them.

If `plugin list` reports that no control surface is running, follow
[Starting a matching development runtime](./AUTHORING.md#starting-a-matching-development-runtime).
It explains how to start the Worker shipped with this CLI and open its Web UI,
without modifying an existing Desktop session.

| Command | Effect |
| --- | --- |
| `opencove plugin guide` | Returns readable, version-matched documentation paths |
| `opencove plugin list` | Lists built-in and installed plugins |
| `opencove plugin install <directory>` | Validates and installs a local directory |
| `opencove plugin details <id>` | Returns an installed local plugin's manifest, README, source directory, assets and recent backend logs |
| `opencove plugin run <id> <command> [--params <json>]` | Runs a declared command; window commands support `--node`, `--view` and `--project` selection |
| `opencove plugin open <id> [--project <id>] [--space <id>] [--node <id>]` | Opens or reuses a plugin window and requests focus |
| `opencove plugin windows <id> [--project <id>]` | Lists durable windows and their current execution views |
| `opencove plugin skill <id> <skill>` | Reads a declared skill and returns its Worker-local path and installation instructions |
| `opencove plugin reload <id>` | Validates and activates a new snapshot of the installed source directory |
| `opencove plugin disable <id>` | Stops a local plugin's content and backend, preserving its nodes and data |
| `opencove plugin enable <id>` | Makes the installed local plugin available again |
| `opencove plugin uninstall <id>` | Removes the local installation; does not delete source or private data |

`list` includes built-in plugins, but `details`, `reload`, `enable`, `disable` and
`uninstall`, as well as contributed commands, windows and skills, operate on local
installations only. View built-in Git Board
documentation and change its enablement in Settings → Plugins. Listing a built-in
ID does not make it a local installation.

Install, reload and run default to a 60-second request timeout to allow validation,
backend activation or window readiness. An explicit `--timeout <ms>` overrides this; other commands
retain their normal default.

`list` and `details` expose declared command and skill metadata. Read
[Commands and skills](./COMMANDS.md) before invoking a contribution. A backend
command needs no window. A window command executes in the selected browser
document; multiple-instance plugins require `--node`, and multiple ready views
of that node require `--view`. Skills are returned for inspection and deliberate
installation; these commands do not modify an agent's skill directories.

Installation reads a directory on the connected runtime's machine. Relative paths
are resolved against the CLI's current directory; use an absolute path and run the
CLI on the same machine as the target runtime. This version does not upload local
files to a remote Worker.

The source remains yours: use Git there normally. Installation and reload copy a
validated immutable snapshot, excluding `.git` and `node_modules`. Build and bundle
any dependencies before installation; the host does not run package scripts or
install dependencies. A failed candidate leaves the active version intact.

## UI and lifecycle

Settings → Plugins lists installed plugins. Each entry opens Markdown documentation
and an optional interactive preview. The plugin's declared action-bar and canvas
context-menu entries are independently visible by default; hide either without
stopping the plugin or existing nodes. Enablement controls execution separately.
Packages without a view have no window creation entries. A plugin declaring
`view.instances: "single"` reuses one window across this Worker's projects;
the default `multiple` permits separate windows.

The host owns each node's header, icon, title, resize, placement, collapse and close.
The plugin owns the content. Collapsing keeps its view mounted; closing releases
the view, while disabling also stops the shared backend. Node geometry survives restart. Plugins explicitly persist user data
through the SDK; a running media stream or JavaScript timer is not a durable state.
Disabled or missing plugins leave recoverable windows instead of deleting nodes.

A detail preview uses temporary storage and a separate backend instance. It
must present honest sample content and must not change workspace data. A preview
is not a separate installation.

## Scope and compatibility

- Local plugin API `1` is a **development API**. Incompatible API versions are
  rejected rather than guessed or silently translated. Use the guide shipped with
  the host you are targeting.
- Plugin IDs are lowercase slugs such as `hello-clock`. There is no required
  publisher prefix. IDs are unique in an installation; collisions are rejected.
- The Node backend is trusted code with full filesystem, process and network
  access on its runtime machine. It runs separately from the UI, with no Node
  integration in the view. This is process isolation, not a permissions sandbox.
- Desktop and Worker Web UI receive the same plugin assets. The browser displays
  the UI and plays media; the Node backend runs on the connected host. Do not assume
  that the viewing device and runtime machine are the same computer.
- GitHub discovery, repository cloning, upstream merge/update, arbitrary host UI
  patches and automatic skill installation remain future work. Declared plugin
  commands, actual window commands, packaged skills, plugin nodes and their
  creation entries are supported through the fixed public plugin interface.
- Built-in Git Board follows application updates. Local install/reload/uninstall
  does not replace built-in implementations.

## Finding the guide

A source or unpacked build returns the original docs directory. An ASAR build
exports a verified copy under `~/.opencove/cache/plugin-guides/<content-digest>` for
ordinary shell and Agent tools. The directory includes the example source files.
Copy an example elsewhere; do not edit this reference cache.

If `opencove plugin guide` cannot start, repair the launcher from Settings →
Connections → CLI → Install CLI. If a running app rejects the documented commands,
check that the CLI and app are from the same build. Do not invent alternate
commands, edit the application's database, or hardcode a plugin into host source.
