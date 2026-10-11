# Host extensions

Plugins declare commands, preferences and themes in `opencove.plugin.json`.
These features do not require a canvas window. A theme or preferences package may
omit both `main` and `view`; plugin commands require a `main` command backend.
All contributions follow installed revision and enablement. No stylesheet,
selector, JavaScript patch or host-internal module is an extension point.

## Commands and menus

```json
{
  "contributes": {
    "commands": [{
      "id": "inspect",
      "title": "Inspect context",
      "description": "Inspect the selected project context.",
      "target": "plugin",
      "menus": ["commandCenter", "canvas", "node", "space"]
    }]
  }
}
```

`menus` defaults to `["commandCenter"]`; `[]` keeps a command available through
the CLI without putting it in host menus. Menu IDs are exact, unique strings.
Both `plugin` and `window` commands can use the first four surfaces below.
Sidebar item actions are backend-only:

| Surface | Context | Window candidates |
| --- | --- | --- |
| `commandCenter` | Active project and optional active Space | Ready views in the explicit active project; all projects when none is selected |
| `canvas` | Project under the canvas menu | Ready views in that project |
| `node` | Project and exact clicked node IDs | Ready views of those nodes belonging to this plugin |
| `space` | Project and exact selected Space | Ready views directly in that Space; child Spaces are separate |
| `sidebar` | Explicit displayed project and declared item action | Backend only; see [Sidebar](./SIDEBAR.md) |

A window command gets a separate item for each concrete ready view. When a node
has multiple clients, the view suffix distinguishes otherwise identical items.
An unavailable window has no executable menu item. Choosing a menu command never
creates a node, opens a hidden document, focuses a different project, chooses a
client by recency, retries a command or broadcasts it. Explicit window creation
continues to require a project, and a `single` view remains singleton per Worker.
The CLI's existing explicit open/run behavior is documented in [COMMANDS.md](./COMMANDS.md).

The same `plugin.command.run` dispatcher serves menus and the CLI. Host menus send
`context` separately from author parameters (menu invocation uses `params: null`)
and include the observed revision/runtime identity. The Worker validates current
availability, the declaration, project/Space/node membership and concrete view
readiness before routing once. A changed installation or expired view fails;
refreshing the menu is a new user action.

A backend handler receives:

```js
runCommand(commandId, params, context) {
  // context.pluginId: string
  // context.host?: { surface, projectId?, spaceId?, nodeIds? }
  // context.preferences?: { [declaredPreferenceId]: string | number | boolean }
}
```

The view SDK supports `api.onCommand((commandId, params, hostContext) => result)`.
The third argument is the same host context or `null` for a CLI invocation without
one. Existing two-argument handlers continue to work.

Context IDs identify host objects; they are not filesystem paths. Pass explicit
project/Space IDs to the [host target facade](./TARGETS.md) to resolve the working
directory and route supported file/process operations. A menu context does not
move plugin code to another machine. The installed backend stays on its owning
Worker; direct Node filesystem and process APIs remain bound to that machine.

## Preferences

```json
{
  "contributes": {
    "preferences": [
      { "id": "compact", "title": "Compact rows", "type": "boolean", "default": false },
      { "id": "limit", "title": "Item limit", "type": "number", "default": 20, "minimum": 1, "maximum": 100 },
      { "id": "order", "title": "Order", "description": "Sort visible items.", "type": "string", "default": "newest", "enum": ["newest", "oldest"] }
    ]
  }
}
```

The small schema accepts scalar `string`, `number` and `boolean` fields. IDs are
unique lowercase declaration IDs. Defaults and enum choices must match the type
and numeric bounds; numbers must be finite and strings are limited to 4,000
characters. A package has at most 100 preference fields. Arbitrary JSON Schema,
HTML controls, executable validators and secrets are outside this API.

Settings → Plugins renders declared fields. Settings can configure an installed
plugin while it is disabled, without starting its backend. Text/number fields
save on blur or Enter; invalid values remain unsaved with an inline error.

`PluginStorageOwner` is the single preference owner. The installation manager
serializes writes with reload/disable/uninstall, and the existing files port
atomically persists values in the Worker's plugin state. Defaults are derived,
not eagerly saved. Reads expose only currently declared, valid values; a removed
or temporarily incompatible field remains stored so restoring its schema can
recover the user's choice. Invalid writes fail without deleting other fields.
Settings never writes a competing copy into `AgentSettings` or localStorage.

The view SDK exposes:

```js
const values = await api.preferences.get()
await api.preferences.set('compact', true)
```

These use the same validated owner as `plugin.preferences.get` and
`plugin.preferences.set` host requests. A view derives plugin identity from its
lease, not a caller-supplied ID. Closed/disabled/uninstalled view leases cannot
write. Settings previews have isolated in-memory preferences initialized from
schema defaults. The generic storage API rejects the reserved
`opencove.host.preferences` key. Backends receive a current preference snapshot
on each command; they should not edit the host preference storage file directly.
The shared `host.preferences` facade is also available to backend commands.
[Lifecycle subscriptions](./EVENTS.md) can sample preference changes; callers then
re-read values. This is not a synchronous push notification.

## Themes

```json
{
  "contributes": {
    "themes": [{
      "id": "dusk",
      "title": "Dusk",
      "appearance": "dark",
      "tokens": {
        "--cove-app-background": "#101823",
        "--cove-window-surface": "#192431",
        "--cove-text": "#f0f4fa",
        "--cove-accent": "#90bfff",
        "--cove-terminal-ansi-red": "#ed8893",
        "--cove-pixel-mint": "#6bd6b6"
      }
    }]
  }
}
```

Each theme declares `light` or `dark`; author separate entries for both modes.
The existing Appearance picker lists enabled, ready contributions dynamically.
The selected identity is `plugin:<plugin-id>:<theme-id>` in existing
`AgentSettings.uiTheme`. This identity survives restart, temporary unavailability,
disable and uninstall. When unavailable, the renderer uses the configured
application default (currently Pixel) without overwriting the selection. Re-enable
or reinstall restores the selected contribution if its identity still exists.
Users can always choose another built-in or contributed theme explicitly.

Themes additionally support built-in visual inheritance, bundled CSS/fonts/assets,
materials, typography and geometry-aware metrics, public component parts and
host-owned motion profiles. See [Themes](./THEMES.md) for the complete contract,
authoring examples, cleanup/recovery behavior and acceptance checklist.

## Owners and invariants

| State | Owner / write entry | Restart truth |
| --- | --- | --- |
| Available declarations | Installed package publication; registry is a renderer projection | Installed immutable package and enablement |
| Preferences | `PluginStorageOwner`, writes serialized by installation manager | Worker plugin state files |
| Desired theme | Existing settings owner and Appearance picker | `AgentSettings.uiTheme` |
| Applied theme | `useApplyUiTheme`; derived from desired identity + available package | Recomputed, never persisted as user intent |
| Window command route | Existing live view lease / `PluginWindowCommands` | None; a new live lease must become ready |

1. A stale/disabled contribution cannot execute; menu dispatch never creates or
   broadcasts to windows, and Space candidates use direct membership.
2. Preference writes have one durable owner; preview and expired view behavior
   cannot overwrite real preferences. Schema changes preserve stored user intent.
3. Theme fallback removes old overrides and never rewrites the selected identity.

The design follows declarative contribution ownership and shared command routing
from [VS Code contribution points](https://code.visualstudio.com/api/references/contribution-points),
and explicit theme identity/base appearance from its
[color theme guide](https://code.visualstudio.com/api/extension-guides/color-theme).
OpenCove uses explicit Worker/project/node/view identities instead of inferring the
active editor or introducing arbitrary condition expressions.

Regression coverage includes declaration rejection, disabled/stale dispatch,
reserved storage, preview isolation, schema restoration, restart persistence,
terminal token cleanup, stale preference request completion and real UI command,
settings and light/dark theme invocation.
