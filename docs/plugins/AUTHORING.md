# Authoring and verification

Read the README returned by `opencove plugin guide` and this guide before building.
The runnable example and [API reference](./API.md) are in the same documentation
directory, including in packaged builds. No OpenCove source checkout is required.

Before writing UI, read [OpenCove plugin design system](./VISUAL_DESIGN.md). Start from its
compact layout and theme-aware control baseline, then adapt the content to the
plugin's task. A reference product supplies ideas, not an extra app shell inside
OpenCove's window.

## Starting a matching development runtime

Choose the intended development runtime/profile first, then run `opencove plugin
list --pretty` against it. If it succeeds, use that runtime and its existing UI.
If it reports `no valid connection info found`, the offline guide
is available but no target runtime was discovered. Start the Worker bundled with
this same `opencove` CLI; an older installed Desktop may not have this plugin API.

The separate profile example below is for creating a chosen development
environment. A Skill operating a user's existing installation must retain that
instance's profile/endpoint and help restore it when stopped. It must not silently
substitute this development profile or any other reachable runtime. See the
[required Skill instructions](./COMMANDS.md#required-operational-instructions-for-skill-authors).

For a separate development profile on macOS or Linux, open a terminal and run:

```sh
export OPENCOVE_USER_DATA_DIR="$HOME/.opencove/plugin-dev"
opencove worker start --user-data "$OPENCOVE_USER_DATA_DIR" --web-ui-password '<choose-a-local-password>'
```

On Windows PowerShell:

```powershell
$env:OPENCOVE_USER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'OpenCove/plugin-dev'
opencove worker start --user-data $env:OPENCOVE_USER_DATA_DIR --web-ui-password '<choose-a-local-password>'
```

Replace the password placeholder with a password for this local development UI.
Keep the startup terminal running. The Worker prints its actual **web ui** URL,
such as `http://127.0.0.1:<allocated-port>/`; open that URL in a browser and sign in
with the password you supplied. Do not guess a port. The Worker defaults to
loopback; a LAN listener is unnecessary for local plugin development.

In a second terminal, set the **same** `OPENCOVE_USER_DATA_DIR` before every group
of CLI commands (shell environment settings do not transfer between terminals):

```sh
export OPENCOVE_USER_DATA_DIR="$HOME/.opencove/plugin-dev"
opencove worker status --user-data "$OPENCOVE_USER_DATA_DIR" --pretty
opencove plugin list --pretty
```

Use the PowerShell environment assignment above on Windows. `worker status`
shows the selected runtime's address and health; the startup log gives the Web UI
URL. The regular CLI reads connection credentials for the selected profile, so
there is no need to copy a token into plugin code or browser URLs.

For a plugin with a node window, create or open a project in this Web UI, then
create its window through a declared action-bar or canvas-menu entry, or use
`plugin open` with an explicit project. Backend commands and other contributions
can work without a window when the plugin declares them that way. Use Settings →
Plugins for the detail page, optional preview and enablement controls.

Without `--user-data` or `OPENCOVE_USER_DATA_DIR`, Worker startup selects the
platform app-data `opencove-dev` directory if it exists, otherwise `opencove`.
The CLI searches those same two locations and picks the newest live connection.
Their parent is `~/Library/Application Support` on macOS, `%APPDATA%` on Windows,
and `$XDG_CONFIG_HOME` or `~/.config` on Linux. An explicit separate profile avoids
ambiguity when several versions are running. Keep runtime data outside your plugin
source directory.

Stop only a development runtime you started, using `opencove worker stop
--user-data <that-directory>`. Do not stop or replace another Desktop/Worker to
make an experiment work. If the launcher reports that a source Worker is not
built, have the runtime maintainer prepare the current build; this is not a plugin
authoring failure and does not require changing the plugin.

## A complete first installation

1. Copy `examples/hello-clock` from the guide directory into a writable directory
   of your choice. Keep source outside the guide cache and application bundle.
2. Read its `opencove.plugin.json`, `main.mjs`, `index.html` and `view.js`. The
   example has no dependencies or build step and is ready to install as copied.
3. Ensure the target OpenCove app or Worker is running. Run:

   ```sh
   opencove plugin install /absolute/path/to/hello-clock --pretty
   opencove plugin list --pretty
   opencove plugin details hello-clock --pretty
   ```

4. In Settings → Plugins, open **Hello Clock**. Read its README and interact with
   the preview. Create a real node through the action bar or canvas context menu.
   Click the clock's update button; the returned timestamp comes from its actual
   Node backend. Save a label, then close and reopen a node to verify persistence.
5. Edit the source label or style and run `opencove plugin reload hello-clock`.
   Source changes are applied only after an explicit reload, without rebuilding
   OpenCove. Existing views use the new snapshot after reload.
6. Test `disable`, `enable` and, when finished, `uninstall`. These commands accept
   the plugin ID, not a directory. Source and private data survive uninstall.

If the example does not install or run, report the exact command, returned error,
`plugin details` output and the failing interaction. Do not conceal an installation
failure by replacing it with a website node or editing OpenCove's source.

## Building your own plugin

Choose a unique lowercase slug and change the example's manifest ID, name,
description and version. If the plugin contributes a node window, provide an HTML
view with external JavaScript and CSS files. The host injects
`window.opencovePlugin` before your scripts. Await its
`ready` promise before reading context or calling the backend. Do not ship your own
bridge, reach into the host DOM, or depend on internal OpenCove imports.

The optional backend is an ESM file exporting `activate(context)`. It returns an
object with `invoke(method, params, viewContext)` for view calls and/or
`runCommand(commandId, params, context)` for plugin-wide commands, plus optional `dispose`.
Window commands use the browser SDK's `api.onCommand` and do not require a backend.
See [Commands and skills](./COMMANDS.md) for targeting, single-window reuse, and skill declarations.
Use Node built-ins directly; bundle other runtime dependencies into distributable
files. A source `node_modules` folder is excluded from snapshots. Local-directory installation does not run install/build scripts, TypeScript
transpilation or a separate development server. Managed Git installation can run an
explicit frozen build strategy; see [Git sources](./DISTRIBUTION.md). Browser assets use relative paths within the plugin directory.

The standard window already has a title, icon, resize handles and close/collapse
actions. Design only its body. Use the SDK to update its title and follow its theme.
The body must adapt to narrow sizes and keyboard use. A custom icon may be a local
SVG, PNG or WebP, with optional dark/light variants. README supports Markdown and
images; preview uses an optional HTML entry and isolated sample data.

## Authoring an operational Skill

An included Skill must cover more than the happy-path command syntax. Follow the
[required operational instructions](./COMMANDS.md#required-operational-instructions-for-skill-authors):
recover the same intended instance through public CLI help when it is stopped,
discover explicit project IDs with `opencove project list`, resolve node/view
ambiguity, and read back the actual result after executing. Include the plugin's
real verification commands and expected fields. Do not ask an agent to infer an
active project, start a replacement instance, choose an arbitrary ready view, or
retry an uncertain mutation automatically.

Test the finished Skill with an agent that has only the installed Skill and public
OpenCove documentation. Start with the intended runtime stopped and include more
than one project and client where supported. Its recovery must preserve the same
runtime, installed plugin, saved nodes and user data. An unavailable instance or
ambiguous target is a recovery/selection step, not permission to create another.

## State and execution ownership

- Node placement, expanded size and collapse are owned and saved by OpenCove.
- Persistent preferences, favorites and queues belong in SDK storage. Its scope is
  the plugin on this runtime, shared across real views; namespace per-node values
  with the supplied `nodeId` when needed. Store JSON data, not active objects.
- Playback, timers and requests belong to the live view or backend. Cancel work and
  release resources when their owner ends. Collapse hides the mounted view; it
  must not reset playback. Closing ends the view. The shared real backend ends on
  disable, reload, uninstall or application exit, not on individual window close.
- Preview storage is separate and temporary, and its backend instance is isolated.
  Respect `viewContext.preview` and provide clearly labeled example data. Never
  start external background work merely because the detail page opened.
- All frontend/backend values must be JSON serializable. Validate the method and
  parameters in the backend. Fetch failures should become useful UI errors, not
  unhandled promise rejections or fake successful content.
- Browser audio belongs to the viewing device. A backend on a remote Worker can
  find a media URL, but should not launch an audio player on that Worker.
- Project files and commands should use [explicit host targets](./TARGETS.md).
  A Space can point to another machine; Node APIs still run on the backend's
  machine. Choose the project explicitly, surface errors, and provide cancellation.

Before sharing, read [compatibility and release policy](./COMPATIBILITY.md).
Declare supported host versions and platforms when needed; test updates against
existing data. A code rollback does not roll back plugin data.

For media features, verify the source's playback rights and actual behavior.
Catalog search, short previews, live radio and full tracks are different features.
Show playback restrictions and unavailable tracks honestly; do not infer broad
catalog coverage from a few examples. Persist stable track IDs if service terms
prohibit retaining audio or metadata. Refresh expiring stream URLs as needed.

## Debug and iterate

`opencove plugin details <id> --pretty` returns the installed manifest, revision,
source location, documentation and recent backend logs. Log useful operation names
with `context.log(...)`; omit credentials, signed media URLs and private content.
A backend exception is returned to the invoking view and should be caught there.

Use the browser console for frontend errors. A blank view commonly means an asset
path is wrong, JavaScript threw before awaiting `ready`, or inline script/style was
blocked. Keep scripts/styles in separate files and use relative asset paths.

If both plugin calls and Settings refresh report `Unauthorized request.`, check
the Web UI login before changing plugin code. The CLI uses a separate credential,
so a working CLI does not prove the browser session is valid. Open `/auth/login`
on that same runtime's Web UI URL, sign in again, then reload the original page.
Keep any unsaved text before reloading; already confirmed SDK writes remain stored.
Never copy the CLI token into the plugin. A failure limited to one view, such as
`OpenCove plugin view closed.`, instead points to its lifecycle: inspect plugin
status and logs, and recreate or reload that view through the host.

When validating a change, first reload the plugin, then inspect its new revision.
A build or activation error must not be reported as a successful reload. If the
manifest changed its ID, install that directory under its new identity instead of
asking the old installation to change identity during reload.

For a local-directory install, manage the source repository normally and reload
after your own merge/build. For a managed Git install, inspect the current editable
source location before editing; update prepares a separate candidate and preserves
the former checkout. Follow [distribution](./DISTRIBUTION.md) for personal edits,
conflict resolution and rollback. An immutable installed snapshot is not the
working copy; do not patch it directly.

## Acceptance evidence

Report each layer separately with its actual result:

- **Installation:** installs from an independent directory, appears in `plugin
  list` and Settings, and requires no OpenCove source edits or rebuild.
- **Real work:** a real node performs the requested operation with real services
  or explicit local fixtures. Demonstrate progress, error and empty states.
- **Presentation:** header/resize/collapse work; both themes and narrow sizes are
  readable; follow the visual guide's hierarchy, controls and accessibility checks;
  collapse does not unexpectedly interrupt ongoing work.
- **Lifecycle:** close, disable/re-enable, reload and complete app restart preserve
  promised user data and stop resources that should end.
- **Preview:** interactive preview works without touching actual stored data or
  starting backend work; its sample limitations are visible.
- **Iteration:** editing source and reloading updates the node. An invalid candidate
  leaves the previous functioning revision usable.
- **Skill, when provided:** a fresh consumer can restore its intended stopped
  instance using public help, select explicit project/node/view identities, run the
  real workflow and verify its result without substituting another instance.

Keep experiment screenshots and logs in the plugin's own work directory, not in
OpenCove source. If a contract is missing, report it; do not invent host APIs or
claim a standalone page is an installed plugin.
