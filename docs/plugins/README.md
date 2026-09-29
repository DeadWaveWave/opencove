# OpenCove plugins

This directory is the versioned guide for OpenCove extensions. The first built in
extension is [Git Board](./GIT_BOARD_MVP.md).

The first plugin API is deliberately small: a plugin declares a manifest, adds
commands through the Control Surface, and renders a node inside the existing
canvas shell. Renderer code does not access Node.js or the file system directly.

Use `opencove plugin guide` to print the absolute path to this README and the
plugin documentation directory installed with the current OpenCove build.

## Current built-in plugin support

Settings → Plugins lists the bundled registry entries, versions and contribution
points. Its enable switch is an application preference (`disabledPluginIds`) owned
by the existing settings persistence pipeline. Missing legacy settings default to
all built-in plugins enabled; unknown disabled IDs are retained. `plugin list`
lists registered manifests, not a running-process inventory.

The detail page also controls the plugin's declared creation locations: action bar
and canvas context menu. These independent preferences live in `pluginContributions`
in the same settings owner and default to visible for new and legacy profiles.
Hiding an entry does not disable the plugin or affect existing windows. Disabling
and re-enabling the plugin preserves both entry preferences. Capabilities that a
plugin does not declare have no corresponding setting.

Disabling a plugin removes its creation actions and unmounts its content. Existing
canvas nodes retain identity, target, position, expanded size and collapse state.
Their host window remains movable, resizable and closable, with a link back to the
plugin settings page. Re-enabling restores the content. Missing plugin identities
and newer data versions are shown as unavailable; they must not be relabeled as
Git Board or silently migrated backwards.

## Canvas window contract

Plugin views use the host's `CanvasNodeWindow`. It owns the themed frame, standard
34px header, 16px kind icon, title typography, action targets, collapse/close
registration and eight resize handles. Plugins supply a title, content and optional
subtitle/actions; they must not duplicate frame or pointer-resize implementations.

The shared resize owner converts screen movement through canvas zoom, previews
position as well as size for top/left edges, then commits through the normal canvas
layout owner. Collapse is presentation-only and does not change the expanded size.
Async content requests must ignore stale responses after target changes or disable;
dragging and resizing a window must not refresh its data.

GitHub discovery/install/update, source checkouts and independently loaded plugin
processes remain planned work in [Git Board MVP](./GIT_BOARD_MVP.md). The current
settings page manages bundled plugins; it does not claim community installation is
available. Built-in plugin versions follow application updates.

## Plugin details and previews

Each installed entry opens a detail page within Settings. Its main documentation
is authored as Markdown, with headings, lists, fenced code, tables, links and
images. Bundled Git Board documentation lives in the renderer catalog under
`src/contexts/plugins/presentation/renderer/catalog/git-board/`, with English and
Chinese README files. `pluginDetails.ts` resolves these documents; their relative
image paths must be registered in the shared `pluginAssets.ts` catalog. HTTPS images
also work, without sending the application URL as a referrer. Raw document HTML,
scripts and local filesystem URLs are not rendered.

Node previews reuse the production view and host window shell in an isolated
canvas. Their example data and geometry belong to the preview alone: dragging,
resizing, collapsing, refreshing or closing the example cannot modify a workspace,
enable a plugin or invoke its runtime. A disabled plugin can still be previewed.
Reset restores the original sample. The catalog is bundled today; these fields
are not yet a public API for dynamically installed plugins.

## Plugin icons

`PluginManifest.icon` declares one identity for settings, creation actions, expanded
windows, collapsed icons and the interactive preview. It is optional; missing
icons or failed image loads use the host's Puzzle glyph.

```ts
icon: { type: 'builtin', name: 'git-branch' } // 'git-branch' or 'puzzle'
// Or an image supplied with a bundled plugin:
icon: { type: 'asset', path: './icon.svg', light: './icon-light.svg', dark: './icon-dark.svg' }
```

Asset paths are exact keys in the host-owned `pluginAssets.ts` catalog. Register
an imported PNG, WebP or SVG URL there when bundling the plugin; a declaration does
not grant access to arbitrary filesystem paths or remote URLs. The optional light
and dark variants follow the application's resolved theme, including Pixel Light;
otherwise `path` is used. Images render as `<img>` with preserved aspect ratio,
never injected SVG markup. Built-in glyphs inherit `currentColor`; an SVG loaded
as an image should supply its own colors or separate theme variants. Independent
plugin installation and asset loading remain future work.
