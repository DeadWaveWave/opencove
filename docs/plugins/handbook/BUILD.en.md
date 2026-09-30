# Your first plugin, with Hello Clock

Start from the working example shipped with your installed build. You can follow
these steps yourself or give the guide to an Agent.

## 1. Find the matching guide

```sh
opencove plugin guide
```

This offline command prints the README path and documentation directory. It does
not start an app or Worker. Open the README, then copy `examples/hello-clock` into
a writable directory of your own. Keep your copy outside the application bundle
and guide cache.

## 2. Understand the small pieces

| File | Responsibility |
| --- | --- |
| `opencove.plugin.json` | Identity and declared contributions |
| `index.html`, `view.js`, `style.css` | The responsive window body |
| `main.mjs` | The optional Node backend |
| `README.md`, `icon.svg` | Documentation and shared plugin identity |

The view uses the injected `window.opencovePlugin` SDK and waits for `api.ready`.
Scripts and styles are separate files. OpenCove already supplies the header,
resize handles, collapse and close controls.

## 3. Install and try the example

With your intended runtime running:

```sh
opencove plugin install /absolute/path/to/hello-clock --pretty
opencove plugin details hello-clock --pretty
```

Open **Hello Clock** in Settings → Plugins. Start its preview and try **Read clock**
and the label field. The preview uses a sample timestamp and temporary data.

Next, create a real Hello Clock window on a project canvas. **Read clock** now
calls its Node backend. Save a label, close the window and create it again: the
label remains. **Add one** tests a separate saved counter. Collapse and expand the
window to see that its view timer keeps running.

## 4. Make it yours

Change a label or style in your copied source, then run:

```sh
opencove plugin reload hello-clock
```

Reopen the details and inspect the new revision. When making a different plugin,
choose a new lowercase manifest ID, name and description, then install it under
that identity. IDs cannot change during reload.

## 5. Verify before sharing

Try light and dark themes, a narrow window, keyboard controls, reload, disable /
enable and a complete app restart. Confirm that promised data survives and that
preview actions do not change real data. Show honest loading, empty and error states.

Use the [API reference](../API.md), [design system](../VISUAL_DESIGN.md) and
[authoring checklist](../AUTHORING.md#acceptance-evidence) to extend the example.
For Agent automation, read [Commands and skills](../COMMANDS.md).
