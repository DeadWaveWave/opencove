# Sidebar contributions

A plugin can add compact project-specific trees to the Sidebar without opening a
window. Declare a section and two backend commands: one returns items; an optional
item action performs work. The host owns disclosure, text, theme and focus styles.

```json
{
  "contributes": {
    "sidebar": [{ "id": "checks", "title": "Checks", "itemsCommand": "items" }],
    "commands": [
      { "id": "items", "title": "Read checks", "description": "Read current items", "target": "plugin", "menus": [] },
      { "id": "run", "title": "Run check", "description": "Run the selected check", "target": "plugin", "menus": ["sidebar"] }
    ]
  }
}
```

`itemsCommand` must name a declared backend command. A section provider receives
`{ projectId }` as parameters and `{ surface: 'sidebar', projectId }` in its host
context. This is the project whose Sidebar is being displayed, including a project
being previewed in a collapsed Sidebar. Do not infer a different active project.

The provider returns:

```js
{
  items: [{
    id: 'group', label: 'Checks', children: [{
      id: 'lint', label: 'Lint', description: 'Ready',
      command: { id: 'run', params: { check: 'lint' } }
    }]
  }]
}
```

IDs must be unique across the returned tree. An item action must name a declared
backend command whose `menus` includes `sidebar`. Clicking it uses the ordinary
command dispatcher with those parameters and the same explicit project context.
It does not create or select a window. Window commands cannot declare `sidebar`.
Labels and descriptions render as text; raw HTML, arbitrary URLs and executable
item payloads are not supported.

## Loading and limits

Sections start collapsed. Opening or refreshing explicitly calls the provider;
there is no timer or hidden background loading. A changed project, installation
revision, runtime generation or disabled plugin invalidates an in-flight result.
Refresh after a plugin revision changes. Provider failures show an inline error.

- At most 8 sections per plugin.
- At most 200 returned items across 5 levels.
- At most 128 KiB of encoded tree data.
- Item actions use the same declared-command bounds as other entry points.

Settings → Plugins → plugin details → **Show in → Sidebar** controls visibility.
It defaults on and is independent of plugin enablement and other entry locations.
Hiding the section keeps its backend, windows and data intact. Unavailable plugins
do not leave executable stale sections behind.

The approach uses declarative, host-rendered trees, also seen in
[VS Code's Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view).
OpenCove uses explicit project context, bounded snapshots and declared backend
actions instead of an unrestricted custom Sidebar document.
