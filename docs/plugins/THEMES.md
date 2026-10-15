# Themes

A theme plugin can change OpenCove's visual foundation, materials, typography,
component skins and motion. It does not need a backend or a canvas window.
Install, update, reload, disable and uninstall it through the same plugin manager
or CLI as any other package. Enabled themes appear in the top-right Control Center and Settings → Appearance.

## Ownership and scope

| Owner | Responsibility |
| --- | --- |
| Application settings | Selected theme identity, font scaling, terminal appearance and effect switches |
| Theme resolver | Applied foundation and fallback; never rewrites the user's selection |
| Installed plugin artifact | Versioned stylesheet, fonts and artwork; never read from mutable source at display time |
| Theme application lifecycle | One active stylesheet, tokens and motion profile per client; cleanup on switch |
| Canvas layout | Window bounds, compact collision size, Space bounds, resize and drag |
| Node runtime | Terminal/editor/plugin content, kept alive across visual transitions |

Three invariants govern the API:

1. Styling and animation do not persist intermediate geometry or recreate node runtimes.
2. User effect switches and reduced-motion preferences win over theme motion defaults.
3. A missing/disabled theme or failed resource load falls back to a usable built-in
   theme while retaining the chosen identity for recovery.

Themes can restyle existing components, including their icons. Replacing the
application's navigation structure or turning Sidebar into a new kind of Dock is
outside this contract. Plugin bodies remain separate documents; they consume the
SDK theme context rather than being styled through the host's DOM.

## Manifest

A minimal package can reproduce the complete Pixel and Pixel Light foundations:

```json
{
  "apiVersion": 1,
  "id": "studio-theme",
  "version": "1.0.0",
  "displayName": "Studio",
  "description": "A pair of workspace themes.",
  "contributes": {
    "themes": [
      { "id": "night", "title": "Studio Night", "appearance": "dark", "extends": "pixel" },
      { "id": "day", "title": "Studio Day", "appearance": "light", "extends": "pixel-light" }
    ]
  }
}
```

A theme-only package declares `contributes.themes` and omits `view`, `preview`,
canvas creation entries (`contributes.actionBar` / `contributes.contextMenu`),
and commands that open a plugin window. Its detail page shows documentation and
plugin management controls, without node previews or creation-location switches.
No diagnostic window is required to install, select or verify a theme; use the
host's existing windows and Appearance previews. A package that intentionally
provides a separate tool window may also declare a `view`; its window entries and
preview remain independent of its theme contributions.

`extends` accepts `dark` and `light` (the Cove foundation) or `pixel` and
`pixel-light` (the Pixel foundation). Manifests that still name the retired
`ember` or `ember-light` foundations keep working and resolve to `dark` and
`light`. `appearance` must agree with that foundation. Without `extends`, the
Cove foundation of the theme's appearance is used. Cross-plugin inheritance is
not supported.
The persisted identity remains `plugin:<plugin-id>:<theme-id>`; the applied
foundation is exposed separately as `data-cove-theme-base`.

Each theme can additionally declare:

```json
{
  "id": "night",
  "title": "Studio Night",
  "appearance": "dark",
  "extends": "pixel",
  "stylesheet": "styles/night.css",
  "tokens": {
    "--cove-accent": "#71bfff",
    "--cove-node-shadow": "0 12px 40px rgba(0, 12, 28, 0.32)",
    "--cove-pixel-header-filter": "blur(12px) saturate(1.15)"
  },
  "typography": { "fontFamily": "Studio Sans, system-ui, sans-serif", "titleFontSize": 12 },
  "metrics": { "headerHeight": 40, "radius": 12, "controlGap": 6 },
  "motion": {
    "creation": { "preset": "pixel", "durationMs": 440 },
    "closing": { "preset": "pixel", "durationMs": 380 },
    "fold": { "durationMs": 300, "easing": "cubic-bezier(0.22, 1, 0.36, 1)" },
    "unfold": { "durationMs": 380 }
  }
}
```

Host styles live in the `opencove` cascade layer. The cascade is foundation →
scoped author stylesheet → manifest tokens and metrics. User font scaling multiplies the theme's scale; explicit terminal font
and terminal appearance settings remain controlled by the user. Avoid `!important`
and overriding layout dimensions in CSS: use the metrics contract below.

## Colors and materials

`tokens` accepts public names and a single CSS value per entry. Color functions,
alpha colors, gradients, shadows and filters are supported where the component
uses that property. URL resources belong in the bundled stylesheet.

Public color tokens:

- `--cove-app-background`, `--cove-app-background-elevated`
- `--cove-surface`, `--cove-surface-strong`, `--cove-window-surface`,
  `--cove-surface-hover`, `--cove-field`
- `--cove-border`, `--cove-border-subtle`, `--cove-text`, `--cove-text-muted`,
  `--cove-text-faint`
- `--cove-accent`, `--cove-accent-text`, `--cove-accent-foreground`, `--cove-focus-ring`
- `--cove-node-surface`, `--cove-node-header-surface`, `--cove-node-border`
- `--cove-terminal-background`, `--cove-terminal-foreground`,
  `--cove-terminal-cursor`, `--cove-terminal-selection`
- `--cove-terminal-ansi-{black,red,green,yellow,blue,magenta,cyan,white}` and
  `--cove-terminal-ansi-bright-{black,red,green,yellow,blue,magenta,cyan,white}`
- `--cove-canvas-dot`, `--cove-pixel-blue`, `--cove-pixel-cyan`, `--cove-pixel-mint`

Public material tokens:

- `--cove-node-background-image`, `--cove-node-shadow`, `--cove-node-shadow-hover`,
  `--cove-node-shadow-focus`, `--cove-node-header-border`, `--cove-pixel-header-filter`
- `--cove-space-surface`, `--cove-space-border`, `--cove-space-shadow`,
  `--cove-space-caption-surface`

For terminal colors, prefer hex or RGB values understood by terminal renderers.
For glass, style a translucent header and backdrop filter while keeping the content
surface legible. Do not use one low-opacity layer across all text and content.

## Typography and geometry-aware metrics

Values are CSS pixels before canvas zoom; no units in JSON.

| Field | Range / meaning |
| --- | --- |
| `typography.fontFamily` | CSS family stack; bundled `@font-face` family names may be referenced |
| `typography.fontSize` | 12–22; theme scale relative to the host's 16px UI scale baseline |
| `typography.titleFontSize` | 10–18; node title baseline, multiplied by UI scale |
| `metrics.headerHeight` | 30–64; actual flex header height, content observes remaining space |
| `metrics.headerPadding` | 4–24; inline padding |
| `metrics.iconSize` | 12–24; header glyph size |
| `metrics.compactIconSize` | 16–36; glyph inside the compact node |
| `metrics.controlGap` | 2–16 |
| `metrics.menuRowHeight` | 28–48 |
| `metrics.sidebarRowHeight` | 28–48; agent rows retain room for their additional information |
| `metrics.controlHeight` | 28–48 |
| `metrics.radius` | 0–24; node shell corner radius |

Every window header, Role included, uses `metrics.headerHeight`. Touch navigation and
menu rows retain a minimum 44px target. Compact nodes keep the shared **112×96**
collision bounds; visual icon sizes can change inside them. Do not override the
outer React Flow transform, width or height. Fold animation reads actual DOM
positions, typography and radii; terminal dimensions are fitted through the
existing terminal geometry owner.

## Public component parts

Use `[data-cove-part="..."]` instead of private implementation classes. The following
parts are the supported skin contract:

| Part | Surface |
| --- | --- |
| `window`, `window-header`, `window-title`, `window-body` | Shared node chrome and content boundary |
| `space`, `space-title` | Space frame and caption; frame pseudo-elements draw the border/corners |
| `compact-window`, `compact-base`, `compact-pixels`, `compact-title` | Compact desktop icon presentation |
| `sidebar`, `sidebar-project`, `sidebar-space`, `sidebar-agent` | Navigation surfaces |
| `menu`, `popover` | Floating interaction surfaces; menus carry `data-material="acrylic"` |
| `surface` | A shared material panel; `data-material` is `solid`, `glass` or `acrylic` |
| `menu-item` | Menu rows; `data-state` is `checked` or `unchecked` on checkbox rows and `data-tone` is `danger` on destructive rows |
| `button`, `icon-button`, `toggle`, `checkbox`, `chip`, `segmented-control`, `text-field` | Shared controls; a selectable chip and each segment have `data-state` `on` or `off` |
| `status-pill` | Agent status; `data-tone` is `working`, `waiting`, `neutral` or `failed` |
| `icon` | Node glyph; `data-cove-kind` distinguishes kinds |
| `effect-background`, `effect-creation`, `effect-closing`, `effect-working` | Host-owned custom motion slots |

Node kind values include `agent`, `terminal`, `task`, `note`, `document`, `folder`,
`role`, `website`, `image`, and `plugin`. For example, an author can use
the stable icon part to paint a bundled replacement:

```css
[data-cove-part='icon'][data-cove-kind='note'] {
  background: url('./note.svg') center / contain no-repeat;
}
[data-cove-part='icon'][data-cove-kind='note'] > * { visibility: hidden; }
```

This keeps the outer glyph geometry and label. `content: url(...)` alone does not
replace inline SVG artwork reliably.
Agent provider and plugin identity remain available on their existing
`data-agent-provider` / `data-cove-plugin-icon` attributes. Decorative replacements
must preserve the control's accessible label and focus indicator.

The compact glyph, `compact-base` and `compact-pixels` occupy the icon area;
`compact-title` sits below it inside the fixed collision bounds. The base is the
backplate and the pixels are decorative, not separate interactive targets. Size
decorations relative to their own box rather than the outer window. A Space's
frame pseudo-elements belong to its existing bounds; changing their border,
background or radius does not resize the Space or its contents.

```css
@font-face {
  font-family: 'Studio Sans';
  src: url('../assets/studio.woff2') format('woff2');
  font-display: swap;
}
:root { --cove-node-header-surface: rgba(20, 38, 58, 0.7); }
[data-cove-part='window-header'] {
  backdrop-filter: blur(12px) saturate(1.2);
  border-bottom: 1px solid color-mix(in srgb, var(--cove-accent) 20%, transparent);
}
[data-cove-part='compact-base'] {
  background-image: url('../assets/grain.svg');
}
```

CSS selectors are automatically scoped to the selected theme. Keyframe names and
references are namespaced. Package-relative images and fonts are embedded in the
installed resource result so they also work through remote Workers and Web UI.
Supported images: SVG, PNG, WebP, JPEG, GIF, AVIF; fonts: WOFF/WOFF2/TTF/OTF.
Font families keep their authored names and are also delivered to plugin iframes.

Define `@font-face` at the stylesheet top level so host and iframe font behavior
agree. Ship bundled CSS with nesting expanded. `@import`, external/file URLs and
package-escaping paths are rejected. Media queries, supports/container/layer rules,
starting styles, keyframes and font faces are supported. Budgets per package:
256KiB CSS, 8MiB unique assets, 12MiB compiled resource expansion. A failed install
or reload leaves the last working version active.

## Motion

Each of `background`, `creation`, `closing`, `working` accepts:

- `{ "preset": "pixel", "durationMs": ... }` uses the native Pixel renderer.
  Creation/closing durations are total lifetimes. Background/working durations
  scale continuous animation speed. Omitted slots retain the native behavior.
- `{ "preset": "none" }` suppresses that effect.
- `{ "preset": "custom", "durationMs": ..., "easing": ..., "keyframes": [...] }`
  uses host-owned decorative layers styled by the theme. Creation also animates
  the real window presentation after its frame is ready; terminal/editor loading
  does not delay the effect.

Creation/closing and fold/unfold allow 0–2000ms; background/working allow
0–60000ms. Zero disables the relevant animation. `fold` and `unfold` accept
`durationMs` and `easing` and retain the host's geometry-aware morph.
`keyframes` accepts 2–16 frames of `opacity`, `transform`, `filter`, `clipPath`
and optional ascending `offset` (0–1). CSS easing keywords, valid cubic-bezier
and steps are supported. Keyframes/easing apply to `custom` effects, not Pixel.
The host owns completion: the last frame of a live creation converges to that
window's steady opacity, transform, filter and clipping; temporary creation/closing
decoration converges to zero opacity. An authored final offset below 1 leaves the
remaining interval for this endpoint. This prevents a jump when animation styles
are released and never commits transient styles into the window.

```json
{
  "background": { "preset": "custom", "durationMs": 10000 },
  "working": {
    "preset": "custom",
    "durationMs": 1400,
    "easing": "ease-in-out",
    "keyframes": [{ "opacity": 0.2 }, { "opacity": 0.8 }, { "opacity": 0.2 }]
  }
}
```

```css
[data-cove-part='effect-background'] {
  background: radial-gradient(ellipse at 30% 20%, #267ab322, transparent 60%);
}
[data-cove-part='effect-working'] {
  border-inline: 2px solid var(--cove-accent);
  box-shadow: inset 0 0 18px #5bbaff22;
}
```

Effect slots have viewport-relative bounds, `--cove-effect-duration`, and a
`data-cove-node-id` where applicable.
Compact nodes retain their static status indicators. Their running/output motion
uses the same `working` declaration: `none`/zero suppresses animation, Pixel uses
the configured duration, and custom renders `effect-working` inside `compact-base`
with bounds local to that icon. Terminal output still comes from the existing
activity signal; a connected terminal is not automatically treated as busy.
Do not add independent infinite timers; let the host own their lifecycle.
On switch, hide/offscreen, cancellation, rapid
reversal or disposal, it cancels animations, removes masks and reveals live
content. Reduced motion and user switches are checked before any effect starts.
A theme cannot replace node runtime logic or change the canonical layout through
its animation declaration.

## Plugin content and recovery

The view SDK supplies `themeId`, `baseThemeId`, `themeVersion: 1`, `tokens`, bundled
`fonts`, and `reducedMotion` alongside the existing `theme` and `colors`.
It applies the tokens and loads/removes font faces in each iframe. The optional
[control baseline](./ui/control-baseline.css) uses the inherited family, scale,
control size and radius. Existing `onThemeChange((theme, colors) => ...)` callbacks
continue to work; a third callback argument contains the expanded context.
See [API](./API.md) for the full view lifecycle.

Disabling or uninstalling a theme removes its CSS, tokens, fonts and animation
profile and displays Pixel. The selected identity remains stored, so reinstalling
or enabling it restores the choice. A resource loading failure shows a recovery
message in Appearance with a built-in theme action. The CLI can disable an authored
theme plugin even if its CSS makes the application difficult to navigate.

## Author verification

Run `opencove plugin guide` for the guide location and CLI help. Install a package,
select each theme in Appearance, and verify:

1. Expanded/compact windows, Space, Sidebar, menus, focused/marked controls.
2. Header resize, rapid fold/unfold, drag and current terminal content.
3. Create/close/working motion, all effect switches off, reduced motion.
4. Plugin runtime and preview contents receive colors, typography and fonts.
5. Reload, disable/enable, restart, missing assets and malformed stylesheet recovery.
6. Desktop and Web UI, dark/light, narrow viewport and touch targets.

Settings → Appearance → Visual Effects includes a working-state specimen and
**Preview Open & Close**. Use it to inspect all effect switches without starting an
Agent. Browser automation can emulate reduced motion per page without changing
the user's operating-system preference:

```js
await page.emulateMedia({ reducedMotion: 'reduce' })
// Check that running effects stop, content stays mounted, and SDK context updates.
await page.emulateMedia({ reducedMotion: 'no-preference' })
```

Use a separate Worker profile and test project for lifecycle and malformed-package
checks. A CSS syntax failure reports the plugin/theme, package-relative stylesheet,
line and column so it can be fixed in the source package before reloading.

Released public parts and fields follow the plugin compatibility policy. Private
classes and DOM hierarchy are not stable extension interfaces. Development-branch
contracts may still evolve before release. This separation follows the public
variable/stylesheet approach in [Obsidian](https://docs.obsidian.md/Reference/CSS%20variables/About%20styling),
while retaining explicit host-owned boundaries similar to
[VS Code's theme contributions](https://code.visualstudio.com/api/extension-capabilities/theming).
