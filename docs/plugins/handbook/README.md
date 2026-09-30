# In-app plugin documentation library

Settings → Plugins → Documentation opens the bundled handbook. The four introductory
articles have English and Simplified Chinese versions. Technical references are the
same version-matched files returned by `opencove plugin guide`; the Chinese index
identifies references whose full text is in English.

The reader reuses `PluginReadme` for Markdown, tables, code, images and external
links. `pluginHandbook.ts` registers documents and image assets. Relative links
resolve only to registered documents, including heading anchors; an arbitrary local
path cannot become a file or filesystem request. External links retain the existing
safe-link policy. Add translated article labels through the plugin settings locale
files, alongside the existing interface copy.

## State and navigation

- The runtime installation registry owns installed status, source history and
  enabled state. Settings owns selected plugin/article, transient pending/error
  feedback and focus/scroll return points. Reading documentation is not a runtime
  operation and must not install, enable or open a plugin.
- Plugin previews start only on explicit request. They use the same generic view,
  window shell and separate preview storage as an installed package. Narrow layout
  respects the manifest's minimum width and preserves the mounted preview view;
  closing ends the preview.
- Discovery chooses an input, never performs installation. Installing, checking
  updates, applying updates and restoring a saved code revision are separate user
  actions. Failed or conflicting candidates must remain visibly unsuccessful.

The compact list/detail structure follows the
[VS Code extension details pattern](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace):
show installed identity and controls at a glance, then put README and contributions
in the detail page. OpenCove keeps its existing settings navigation and runtime
owners; no marketplace download counts, ratings or availability claims are inferred.

Targeted tests cover registered Markdown links, language selection, focus return,
explicit installation/update actions and independent previews. Electron tests in
`plugins.details.spec.ts` and `plugins.library.spec.ts` cover real installed content,
Markdown images, light/dark rendering and narrow layouts. Review screenshots remain
outside the source tree.
