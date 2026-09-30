# Local plugin API 1

This is a development contract. Declare `apiVersion: 1`; incompatible values fail
installation. There is no package to download for the view SDK. OpenCove injects
it into your HTML before your external scripts execute.

## Package

The root of the install directory contains `opencove.plugin.json`:

```json
{
  "apiVersion": 1,
  "id": "hello-clock",
  "version": "0.1.0",
  "displayName": "Hello Clock",
  "description": "A minimal independent plugin.",
  "author": "Your name",
  "icon": { "type": "asset", "path": "icon.svg" },
  "main": "main.mjs",
  "view": {
    "entry": "index.html",
    "width": 480,
    "height": 340,
    "minWidth": 320,
    "minHeight": 240
  },
  "preview": "index.html",
  "readme": "README.md",
  "contributes": { "actionBar": true, "contextMenu": true }
}
```

Required: `apiVersion`, `id`, `version`, `displayName`, `description`, and
`view.entry`. Paths are relative to the package root and must reference packaged
files, not absolute paths, traversal paths or external URLs. Keep the package
self-contained; do not rely on symlinks or `node_modules` being copied.

The package limit is 64 MiB, 2,000 files and 16 MiB per file. Install a bundled
distribution directory if the source contains unrelated assets or tooling. Window
dimensions must be between 100 and 4,000 pixels; initial size cannot be smaller
than its declared minimum.

Optional fields:

| Field | Meaning |
| --- | --- |
| `main` | Node ESM entry exporting `activate`; omit for a UI-only plugin |
| `view.width`, `view.height` | Initial expanded size; defaults 640 × 440 |
| `view.minWidth`, `view.minHeight` | Minimum expanded size; defaults 320 × 220 |
| `preview` | HTML entry for Settings preview; may reuse `view.entry` |
| `readme` | Markdown documentation file |
| `author` | Displayed author text |
| `icon` | Built-in glyph or packaged image declaration |
| `contributes.actionBar`, `contributes.contextMenu` | Creation entries, both default true |
| `platforms` | Supported backend OS values: `darwin`, `linux`, `win32`; omit for all |

An icon may be `{ "type": "builtin", "name": "puzzle" }` (or `git-branch`), or
`{ "type": "asset", "path": "icon.svg", "light": "icon-light.svg", "dark":
"icon-dark.svg" }`. PNG, WebP and SVG are accepted. Theme variants are optional;
image SVGs should contain their own colors. The same identity is used in settings,
creation actions and expanded/collapsed windows.

IDs are installation-wide lowercase slugs, not display names. Do not change an ID
on reload. Installing an already installed ID fails with a reload instruction;
built-in IDs cannot be replaced. The host derives one node kind from each local
plugin ID. This version does not dynamically register arbitrary commands or other
host UI locations.

## Browser SDK

```js
const api = window.opencovePlugin
const context = await api.ready
```

`ready` resolves to:

```ts
{
  apiVersion: 1
  pluginId: string
  nodeId: string
  workspaceId: string | null
  directoryPath: string | null
  preview: boolean
  theme: 'light' | 'dark'
  colors: Record<string, string>
}
```

`directoryPath` describes the node's host context. Do not assume it exists or is a
path on the viewing device. There is no Node access in the view.

| Method | Result |
| --- | --- |
| `await api.invoke(method, params)` | JSON result from your Node backend handler; default params is null |
| `await api.storage.get(key)` | JSON value, or null when absent |
| `await api.storage.set(key, value)` | Persists a JSON value under this plugin ID |
| `await api.setTitle(title)` | Updates this node's host title; nonempty, at most 200 characters |
| `api.onThemeChange((theme, colors) => { ... })` | Registers a callback; returns an unsubscribe function |

Storage is shared across real views of the plugin on this runtime. Use your own
key/schema version and include `nodeId` if a value is per node. Values must be JSON
serializable. Read/modify/write from multiple views is not an atomic transaction;
avoid competing writers for the same key. Do not store credentials in displayable
frontend state.

Persist explicit user changes when they happen, and await `storage.set` before
reporting that a change has been saved. A closing view loses its SDK lease: do not
depend on an asynchronous `pagehide` or unload handler to save favorites, queues or
other confirmed edits. Debounce transient progress if appropriate, with a clear
recovery tolerance; a failed write must not be presented as a saved change.

Keys are 1–100 characters, start with a letter or digit and contain only letters,
digits, `_`, `-` or `.`. Each value must fit within 1 MiB of JSON. A backend response
must fit within 2 MiB. Keep media binaries and large collections out of SDK storage.

The host applies `data-theme="light|dark"` and `data-cove-theme` to the document
root and supplies these CSS custom properties:

```css
--cove-text
--cove-text-muted
--cove-surface
--cove-accent
--cove-border
--cove-window-surface
```

Use these for body colors. The host renders the header and frame. Use external JS
and CSS files referenced with relative URLs; inline scripts, inline handlers and
inline styles are not part of this contract. A bundler must emit standalone browser
assets rather than requiring a development server or injecting style tags at run
time. The SDK is injected automatically: do not include another SDK script.

A failed invocation or expired view rejects its promise. Catch it and show a useful
error. Do not render arbitrary service text with `innerHTML`. Backend calls have a
30-second execution timeout and SDK requests time out after 45 seconds. Design
long work as short polling calls or keep it in the view.

## Node backend

```js
export async function activate(context) {
  context.log('Clock backend ready')
  return {
    async invoke(method, params, viewContext) {
      if (method !== 'clock.now') throw new Error(`Unknown method: ${method}`)
      return { iso: new Date().toISOString(), preview: viewContext.preview }
    },
    async dispose() {
      // Release timers, child processes, subscriptions and open handles.
    },
  }
}
```

Activation context contains `pluginId`, `dataDirectory` and `log(message)`.
`dataDirectory` is writable, plugin-private storage on the runtime machine; source
and installed snapshot are not data directories. `viewContext` contains
`pluginId`, `nodeId`, `workspaceId`, `directoryPath` and `preview`, as above.
Validate invocation methods and parameters. Return JSON-compatible values.

The backend is a trusted Node child process with full OS access, not a sandbox.
Node standard-library imports work; bundle other dependencies before installation.
Do not assume `process.cwd()` is a project root: use the supplied view context.

A real backend instance is shared by all real views of an enabled plugin. It can
remain alive with no open windows. `dispose` is called during disable, reload,
uninstall and host shutdown; it is not a per-window close callback. Handle your
own asynchronous work deliberately. Opening a window should not repeat global
initialization. Do not perform destructive or irreversible work during activation.

Backend stdout/stderr and `context.log` provide diagnostic information through
`plugin details`. Keep logs concise and omit tokens and private user content.
A failed backend must yield a visible error rather than crashing the host. Do not
rely on automatic retries for external operations with side effects.

## Preview

Settings loads the declared `preview` HTML with `context.preview === true`. It has
its own temporary SDK storage, separate backend instance and temporary backend
data directory. Closing the preview disposes that instance and removes its data.
It never receives real plugin favorites or preferences, and its `setTitle` does
not rename a canvas node.

This isolation does not prevent trusted backend code from accessing the OS or
network. Respect `viewContext.preview`: use clearly labeled sample data by default;
start external requests only when appropriate for a deliberate user interaction.
Keep `activate` free of writes or external work unrelated to instance setup because
activation itself has no real-view context. Sharing the same HTML/body code between
preview and production avoids a misleading fake preview.

## Lifecycle

| Operation | View / backend / data |
| --- | --- |
| Collapse / expand | Same mounted view; expanded geometry retained |
| Close node | View released; shared backend may remain active |
| Disable | Views released, backend stopped, nodes and private data retained |
| Enable | Installed snapshot becomes available again |
| Reload | New snapshot activated; views restart; private data retained |
| Failed reload | Existing valid installation remains active |
| App restart | Installation and durable data restored; transient JS state restarts |
| Uninstall | Installation removed; source, node placeholders and private data retained |

Media playback is transient browser state. Collapse can preserve it; reload or
restart does not preserve a live audio object. Persist track IDs, position and user
preferences if needed, then offer deliberate playback resume subject to browser
rules. Do not claim playback continues after closing unless a separately supported
persistent playback owner implements it.
