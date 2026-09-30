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

## Give the documentation to your Agent

Copy this command into your terminal or Agent task:

```sh
opencove plugin guide
```

The result includes local paths an Agent can read. Ask it to use the supplied API
and visual guide, create the plugin in an independent directory, install it on the
intended runtime, and verify a real window plus its preview. A standalone web page
is not an installed OpenCove plugin.

If the launcher needs repair, use **Settings → Connections → CLI → Install CLI**.
For setup details, start with [Authoring and verification](../AUTHORING.md).
