# Hello Clock

![Clock icon](icon.svg)

A dependency-free example of a real, independently installed OpenCove plugin.
Copy this entire folder to your own writable location before editing it.

```sh
opencove plugin install /absolute/path/to/hello-clock
opencove plugin details hello-clock --pretty
```

Create **Hello Clock** using the canvas action bar or right-click menu. Click
**Read clock** to invoke the Node backend and display its timestamp. Enter a label
and save it to exercise plugin storage and the shared window title. The label is
shared by real instances and survives closing a window or restarting the app.
**Add one** exercises a separate persisted counter. The **View alive** timer shows
the lifetime of this UI instance and continues when its window is collapsed.

The settings preview uses a sample timestamp and temporary storage. It cannot
change the real saved label. Theme colors follow the host. Resize, collapse and
close come from OpenCove's standard window, not duplicated plugin controls.

## Files

| File | Purpose |
| --- | --- |
| `opencove.plugin.json` | Identity, API version, view, backend and preview declarations |
| `main.mjs` | Node backend exporting `activate`, `invoke` and `dispose` |
| `index.html`, `view.js`, `style.css` | Responsive body using the injected browser SDK |
| `icon.svg` | Shared icon for settings and canvas |
| `README.md` | This detail-page documentation |

No package installation or development server is needed. Change source, then run
`opencove plugin reload hello-clock`; the application itself is not rebuilt.
Read `../../API.md` in the guide directory before extending the example. Backend
code has trusted Node access, while the view is browser code.

```sh
opencove plugin disable hello-clock
opencove plugin enable hello-clock
opencove plugin uninstall hello-clock
```

Uninstall retains your source and private data. To build a different plugin,
change the manifest ID before installing it; IDs cannot change during reload.
