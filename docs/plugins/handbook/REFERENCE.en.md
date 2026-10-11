# A guide that matches your build

The documentation library is bundled with OpenCove, so it remains available offline.
The technical references below are the same files returned by `opencove plugin guide`.
Use those contracts when building a plugin for this version.

## Build and design

- [Authoring and verification](../AUTHORING.md) — choose the intended runtime,
  install the example, iterate and verify lifecycle behavior.
- [Plugin API](../API.md) — manifest schema, view SDK, backend calls, storage and theme.
- [Visual design system](../VISUAL_DESIGN.md) — layout, type, theme tokens,
  understandable controls and a reusable CSS baseline.
- [Hello Clock example](../examples/hello-clock/README.md) — the files and behaviors
  in the runnable starter package.

## Commands and automation

- [Commands and skills](../COMMANDS.md) — declared operations, explicit window
  targeting and instructions an Agent can use.
- [Runtime ownership](../RUNTIME.md) — installation, snapshot, view and backend
  boundaries for developers working on the host.
- [Project targets](../TARGETS.md) — explicit local/remote files and cancellable operations.
- [Compatibility](../COMPATIBILITY.md) — host versions, platforms, release contracts and data migrations.

- [Host API map](../HOST_API.md) — the complete capability inventory, targets and lifetimes.
- [Files](../FILESYSTEM.md), [nodes and sessions](../CANVAS_API.md), [events](../EVENTS.md)
  and [Sidebar](../SIDEBAR.md) — detailed method and declaration contracts.
- [Git distribution](../DISTRIBUTION.md) — repository details, builds, conflicts and recovery.

## Give the documentation to your Agent

Copy this command into your terminal or Agent task:

```sh
opencove plugin guide
```

The result includes local paths an Agent can read. Ask it to use the supplied API
and visual guide, create the plugin in an independent directory, install it on the
intended runtime, and verify its declared capabilities. If it contributes a node
window, verify that real window and its preview; a plugin with only backend
commands or other contributions does not need a window. A standalone web page is
not an installed OpenCove plugin.

If the launcher needs repair, use **Settings → Connections → CLI → Install CLI**.
For setup details, start with [Authoring and verification](../AUTHORING.md).

- [Theme development](../THEMES.md) — foundations, CSS/assets/fonts, component parts and motion.
