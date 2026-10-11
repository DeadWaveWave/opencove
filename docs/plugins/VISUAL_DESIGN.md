# OpenCove plugin design system

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
| Content design | Content and layouts can have their own identity while controls, spacing and interaction states remain consistent. |

The plugin body is part of a resizable canvas window. Keep its structure compact,
make the main action clear and reserve most of the space for useful content.
Identity artwork is content, not a replacement for host colors.

## Layout and hierarchy

Start with the smallest arrangement that supports the main task:

```text
┌ Host header: icon · title · collapse · close ┐  ← supplied by OpenCove
│ Search / view choice              actions  │  ← optional compact toolbar
│                                            │
│ Main content                               │  ← gets the available space
│                                            │
│ Context / one primary action               │  ← optional footer
└────────────────────────────────────────────┘
```

- Use one main scroll region. Keep useful controls reachable as content grows;
  avoid simultaneous outer scrolling and nested scrolling through the same list.
- A toolbar belongs directly below the host header. Use a subtle divider rather
  than wrapping every toolbar, list and footer in a separate rounded card.
- Omit a toolbar/footer when it has no real function. Empty space need not be
  filled with headings, instructions, status labels or decoration.
- The host already shows the plugin identity. Inside the body, headings describe
  the current content rather than repeating the plugin name.
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
| Content rows | Usually 32–36px; artwork or a second text line can justify more |
| Toolbar | 32px controls with 4–6px vertical padding; avoid stacking redundant toolbars |
| Button / input | 30–32px height, 6px radius, 8–10px horizontal padding |
| Icons | 16px in ordinary controls; consistent stroke weight and optical alignment |
| Touch targets | At least 44 × 44px for coarse pointers; the glyph can stay small |
| General-purpose initial node | Around 560–640px wide and 360–460px high; choose for the actual content |

Use a system font stack. Use a monospace face only for code, paths or data that
benefits from column alignment. Numeric values can use
`font-variant-numeric: tabular-nums` without making the entire UI monospace.
The SDK supplies colors, typography and metric tokens; the baseline below follows
them. These dimensions are fallback authoring defaults. See [Themes](./THEMES.md)
for the public metric contract and font-resource behavior.

## Theme and material

Start with these semantic colors; the full public token surface is in
[Themes](./THEMES.md):

| Token | Use |
| --- | --- |
| `--cove-window-surface` | Base content background |
| `--cove-surface` | Inputs or a subtly raised content area |
| `--cove-text` | Main text, headings and important values |
| `--cove-text-muted` | Supporting text and quiet icons |
| `--cove-border` | Dividers and control boundaries |
| `--cove-accent` | Focus, active state and restrained primary emphasis |

Read [API.md](./API.md) for `data-theme` and `onThemeChange`. Do not import the
host's private stylesheet or assume undocumented variables exist in an iframe.
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

Copy [ui/control-baseline.css](./ui/control-baseline.css) into the plugin package
and load it as an external stylesheet with a relative URL. It uses only the six
public theme tokens above and works without a framework or extra dependency.
It is an optional, editable starting point, not an automatically injected library
or another SDK API. Layout, accessible markup and event handlers remain the
plugin's responsibility. Do not load it from the guide cache at runtime.

Use the classes that fit the view; unused regions are optional:

| Class | Purpose |
| --- | --- |
| `cove-plugin-view` | Full-height root, system typography and theme surface |
| `cove-plugin-toolbar` | Compact top row with a subtle bottom divider |
| `cove-plugin-content` | Flexible, scrollable main content region |
| `cove-plugin-footer` | Optional bottom action or context row |
| `cove-plugin-button` | Standard button; retain this base class when adding a modifier |
| `cove-plugin-button--primary`, `cove-plugin-button--ghost`, `cove-plugin-button--icon` | Primary action, quiet action or square icon action |
| `cove-plugin-input` | Text input, select or textarea with a visible focus state |
| `cove-plugin-field` | Label and control arranged vertically |
| `cove-plugin-heading` / `cove-plugin-secondary` | Content title / supporting text |
| `cove-plugin-grow` / `cove-plugin-truncate` | Flexible width / deliberate single-line truncation |

Place the root on the view's body. Keep semantic elements: a real `button`, a
label associated with its input, and `aria-pressed` only for a toggle. The baseline
does not make an ordinary button into a tab or menu. Add the correct keyboard and
focus behavior when implementing those controls. Destructive actions need clear
wording and confirmation proportional to the consequence; the public color API
does not currently supply a destructive-action token.

Keep icon-only actions square with an accessible name and a hover/focus label.
Use one consistent icon family for controls; package its assets and respect its
license. Prefer a deliberate SVG/PNG/WebP identity over emoji for the plugin icon.
Content imagery can differ from control glyphs.

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

## Visual acceptance for an Agent

Before calling the plugin complete, inspect the actual installed view, not only a
standalone page. Capture it in a host light and dark theme, at its initial and
minimum sizes. Check keyboard focus, long labels, empty/error/loading states and
reduced motion. Confirm the host frame is not duplicated and the first screen
makes the main task obvious. Exercise real controls rather than judging a static
mockup alone. Report deviations and untested states honestly.
