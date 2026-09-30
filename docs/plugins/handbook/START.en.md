# Make room for your own tools

Plugins bring useful tools into the place where you work. A plugin might show a clock,
provide a focused canvas window, or expose commands an Agent can run. Each package
chooses which of those features it provides.

OpenCove supplies the surrounding window: moving, resizing, collapsing and closing.
The plugin supplies its content. You can keep a tool beside a terminal, note or task
without giving it a separate application workspace.

## Ways to use a plugin

| Contribution | Where to find it |
| --- | --- |
| Canvas window | The canvas action bar or right-click menu, when declared |
| Commands | The plugin's detail page lists commands and how to call them |
| Skills | The detail page provides an installation prompt to share with your Agent |
| Preferences | Declared controls appear on the plugin detail page |
| Themes | Enabled plugin themes appear in Settings → Appearance |

A package may have no window at all. The detail page shows what that plugin actually
provides, including its README, version and optional interactive preview.

Commands can also appear in the command center or declared canvas, node and Space
menus. Each location uses the context supplied by OpenCove; a window command requires
an available target view. Read [Host contributions](../HOST_EXTENSIONS.md) for details.

## Your plugin shelf

**Settings → Plugins** is the home for installed plugins. Select a row to read about
it. The switch enables or disables execution; hiding an action-bar or right-click
entry only changes where its shortcut appears.

Disabling preserves existing windows and saved data. Closing one window ends that
view. Collapsing keeps it mounted. **Uninstall** removes the installation while
retaining source files and private data for reinstalling.

## Try a preview first

When a plugin declares a preview, choose **Start preview** in its detail page.
Drag, resize and collapse the sample window, then try the plugin's controls. Preview
storage and backend are separate from real windows. Closing the preview ends it.
The plugin author is responsible for making sample content honest and avoiding
external work in preview mode.

## Choose your next step

- [Install and use a plugin](./INSTALL.en.md)
- [Build your first plugin with Hello Clock](./BUILD.en.md)
- [Find the API and design references](./REFERENCE.en.md)

A plugin backend runs trusted code on the connected runtime machine. Review the
source and publisher before installing a package.
