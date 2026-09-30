# Plugin visual design

Read this before designing a plugin view. It is the default visual baseline for
OpenCove plugins, shipped beside the API guide. It is self-contained: an author
does not need OpenCove source, internal React components or a separate UI package.

The goal is a useful window on a shared canvas: recognizable controls, readable
content and enough room for neighboring windows. Adapt these defaults when the
plugin's actual work benefits from a different layout. Keep the host contracts
and accessibility requirements below intact.

## Three levels of consistency

| Level | Responsibility |
| --- | --- |
| Host contract | OpenCove owns the outer frame, header, identity, focus, drag, resize, collapse, close and creation effects. Do not draw a second window shell. |
| Recommended baseline | Follow the typography, density, control states and theme colors below. Deviations should serve a concrete interaction. |
| Plugin expression | Artwork, charts, editors, media and domain-specific layouts can have their own identity. A music player and a Git graph need not look identical. |

An external reference such as Apple Music can inform content hierarchy and
playback interactions. Translate it to a resizable canvas window; a full product
sidebar, promotional hero and repeated app logo usually consume the space needed
for the user's task. Brand artwork is content, not a replacement for host colors.

## Layout and hierarchy

Start with the smallest arrangement that supports the main task:

```text
┌ Host header: icon · title · collapse · close ┐  ← supplied by OpenCove
│ Search / view choice              actions  │  ← optional compact toolbar
│                                            │
│ Main content: list, graph, editor or media   │  ← gets the available space
│                                            │
│ Context / playback / one primary action     │  ← optional footer
└────────────────────────────────────────────┘
```

- Use one main scroll region. Keep useful controls reachable as content grows;
  avoid simultaneous outer scrolling and nested scrolling through the same list.
- A toolbar belongs directly below the host header. Use a subtle divider rather
  than wrapping every toolbar, list and footer in a separate rounded card.
- Omit a toolbar/footer when it has no real function. Empty space need not be
  filled with headings, instructions, status labels or decoration.
- The host already shows the plugin identity. Inside the body, headings should
  describe content such as "Queue" or "Changed files", not repeat the plugin name.
- Secondary navigation starts as a small tab/view control. Use a persistent inner
  sidebar only when there is enough width and several distinct destinations.
- Prefer a neutral content surface and thin dividers. At most one additional
  raised surface is usually needed for an inspector or contextual action.
- Avoid marketing copy, giant welcome banners, all-caps letter-spaced eyebrows,
  permanent onboarding instructions and pill-shaped containers for every label.
  Empty states can offer one clear next action.

## Recommended dimensions

All sizes are CSS pixels inside the view; canvas zoom belongs to the host.

| Element | Baseline |
| --- | --- |
| Body text / controls | 13px, line-height 1.45–1.55, normal weight |
| Supporting text | 12px; never make essential information tiny or faint |
| Section title | 14px / 600; use 16–18px for a genuinely prominent content title |
| Content padding | 12–16px; 8–12px in narrow views |
| Spacing scale | 4, 8, 12, 16, 24px |
| Toolbar / list rows | Usually 32–36px; artwork or a second text line can justify more |
| Button / input | 30–32px height, 6px radius, 8–10px horizontal padding |
| Icons | 16px in ordinary controls; consistent stroke weight and optical alignment |
| Touch targets | At least 44 × 44px for coarse pointers; the glyph can stay small |
| General-purpose initial node | Around 560–640px wide and 360–460px high; choose for the actual content |

Use a system font stack. Use a monospace face only for code, paths or data that
benefits from column alignment. Numeric counters and playback times can use
`font-variant-numeric: tabular-nums` without making the entire UI monospace.
The current SDK supplies theme colors, not a font or density API; these dimensions
are authoring defaults, not additional SDK fields.

## Theme and material

Only these color tokens are currently supplied by the public SDK:

| Token | Use |
| --- | --- |
| `--cove-window-surface` | Base content background |
| `--cove-surface` | Inputs or a subtly raised content area |
| `--cove-text` | Main text, headings and important values |
| `--cove-text-muted` | Supporting text and quiet icons |
| `--cove-border` | Dividers and control boundaries |
| `--cove-accent` | Focus, active state and restrained primary emphasis |

Read [API.md](./API.md) for `data-theme` and `onThemeChange`. Do not import the
host's private stylesheet or assume other `--cove-*` variables exist in an iframe.
Use the injected tokens for chrome; artwork and meaningful data colors may retain
their identity. Check their contrast in both host themes.

Default surfaces should be quiet and solid enough for text. Avoid stacking glass,
strong shadows, luminous borders or translucent cards over every section. The
host supplies the window material and pixel effects. Do not add another animated
dot background or imitate its fold/creation effects inside the view.

Use a light accent tint for active controls, keeping text in `--cove-text` unless
you have verified another foreground's contrast. White text over arbitrary host
accent colors is not a reliable default. Selection must also have a shape, icon,
text or accessible state; color alone is insufficient.

### Copyable control baseline

Place this in the plugin's own external stylesheet and reference it relatively.
It is an optional starting point, not an automatically injected component library.
Layout and event handlers remain the plugin's responsibility.

```css
:root {
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: var(--cove-text);
  background: var(--cove-window-surface);
  color-scheme: light;
}
:root[data-theme='dark'] { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
button, input, select, textarea { font: inherit; color: inherit; }
button, input, select {
  min-height: 32px;
  border: 1px solid var(--cove-border);
  border-radius: 6px;
  background: var(--cove-surface);
  padding: 5px 10px;
}
button { cursor: pointer; }
button:hover:not(:disabled), button[aria-pressed='true'] {
  background: color-mix(in srgb, var(--cove-accent) 10%, var(--cove-surface));
}
button.primary {
  background: color-mix(in srgb, var(--cove-accent) 18%, var(--cove-surface));
  border-color: color-mix(in srgb, var(--cove-accent) 55%, var(--cove-border));
}
button.ghost { border-color: transparent; background: transparent; }
:where(button, input, select, textarea, a):focus-visible {
  outline: 2px solid var(--cove-accent);
  outline-offset: 2px;
}
button:disabled { opacity: .55; cursor: default; }
.secondary { color: var(--cove-text-muted); }
@media (pointer: coarse) {
  button, input, select { min-height: 44px; }
  button { min-width: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

Keep icon-only actions square with an accessible name and a hover/focus label.
Use one consistent icon family for controls; package its assets and respect its
license. Prefer a deliberate SVG/PNG/WebP identity over emoji for the plugin icon.
Brand identities and album art can differ from control glyphs.

## Interaction and responsive behavior

- One primary action per active region; secondary actions should be quieter.
  Use text for unfamiliar actions instead of relying on an unexplained icon.
- Search expands within its toolbar; at narrow widths, hide lower-priority actions
  into an explicit menu rather than wrapping the toolbar into several rows.
- At the declared minimum width, preserve the main task and essential actions.
  Change two columns to one and make optional inspectors dismissible. Use the
  iframe's available width, not the screen or the parent app's width.
- Long names truncate or wrap deliberately; provide the full value on demand.
  Reserve control space so a long title cannot push actions outside the view.
- Keyboard focus must be visible. Use real buttons and labels; keyboard shortcuts
  must not intercept text editing or require hover-only controls.
- Loading, no results, failure, disabled and selected states need distinct meaning.
  Reserve a small status area when updates would otherwise shift content. Errors
  should explain the next action and preserve useful content.
- Keep motion short (roughly 120–180ms) and local to the changing element. It must
  not delay input, resize the host window or restart work. Respect reduced motion.
- A settings preview uses the same content components and styles as a real node.
  Label sample content, and retain the runtime/storage isolation in [API.md](./API.md).

## Example: music player in a canvas

A useful starting layout is **search/view controls → track list → playback bar**.
At around 600 × 440px, show a modest current-track cover (48–64px), track/artist
identity, play/pause, previous/next and a readable progress control. Give most of
the remaining height to tracks. Open the queue on demand; a wider window can show
it alongside the list. At narrow sizes, place it in the same content region with
a clear return action.

Keep album art and music identity expressive. Let window chrome, navigation and
control density belong to OpenCove. Avoid spending the initial view on a separate
brand sidebar, large record illustration, slogan and welcome heading. Show full
track, preview and unavailable states honestly, near the affected item. Do not
claim a play button works without exercising real audio.

This is a design direction, not a claim that an existing music plugin already
implements this arrangement. A plugin author should verify it at the chosen
manifest minimum size and adjust its responsive layout accordingly.

## Visual acceptance for an Agent

Before calling the plugin complete, inspect the actual installed view, not only a
standalone page. Capture it in a host light and dark theme, at its initial and
minimum sizes. Check keyboard focus, long labels, empty/error/loading states and
reduced motion. Confirm the host frame is not duplicated and the first screen
makes the main task obvious. Report deviations and untested states honestly.

The runnable [Hello Clock](./examples/hello-clock/README.md) demonstrates the SDK,
storage and lifecycle; its clock-specific typography is not a universal layout
template. Use the baseline above for the new plugin's controls and structure.

This guidance applies the host integration, theming and accessibility principles
in the [VS Code webview UX guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews)
to OpenCove's resizable canvas. It deliberately allows broader plugin content,
including music, rather than adopting an editor-only restriction.
