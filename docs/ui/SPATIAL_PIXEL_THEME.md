# Spatial Pixel Theme

Pixel is an opt-in dark theme for OpenCove's spatial workspace. It uses deep blue surfaces,
violet-to-blue-to-mint pixel colors, clear node boundaries, and bounded output activity feedback.
Select it through the existing Appearance theme picker or Control Center. It does not change the
default theme, the existing Light/Dark/Ember themes, or terminal execution behavior.

## Theme ownership

`settings.uiTheme` remains the single source of truth. Pixel is registered through `UI_THEMES`
and `UI_THEME_DESCRIPTORS`, with both `baseScheme` and `terminalScheme` set to `dark`.
Its palette is defined in `src/app/renderer/styles/themes/pixel.css` and consumed through semantic
`--cove-*` tokens. Terminal colors continue through the existing applied appearance snapshot owner.

Node surface color and node material are separate tokens: consumers such as Document Node use the
surface color in `color-mix`, so the surface token must not become a gradient. Node header, input,
resize, selection and Find geometry keep their existing contracts.

## Canvas effects

The Pixel canvas is a viewport-sized, read-only visual layer. It draws a deterministic gradient
matrix and briefly highlights visible node edges when the existing PTY event hub delivers output.
It retains only bounded session/timestamp observations, not output text or persisted application state.

Agent identity and status use `resolveAgentPresentation`, including normal terminal nodes with an
Agent overlay. `working`, `waiting`, failure and degraded observation retain their existing meanings.
Received output does not establish a tool category, newly generated text, success or task completion.

The layer must:

- Be `aria-hidden` and `pointer-events: none`; never enter keyboard focus order.
- Read existing viewport, node geometry and session references; never write them.
- Stay outside the terminal body and never resize or remount xterm/Monaco.
- Coalesce output bursts into a bounded visual scheduler, capped at 25 frames per second and DPR 2.
- Stop scheduling frames after activity decays; idle background remains static.
- Stop drawing when hidden/offscreen without pausing Agent execution or dropping runtime output.
- Render a static field with reduced motion and disable activity particles.
- Discard stale activity on node/session changes and dispose all subscriptions and animation frames.
- Skip filtered-out and offscreen nodes and allocate buffers for the viewport, not the infinite world.

## Interaction boundaries

The website showcase contains scripted mouse actions, timed tool calls, illustrative test results and
an input-blocking node reveal. These behaviors are not part of the application theme. In particular,
application effects never delay operability, interpret ANSI text as tool events, or auto-open documents.

File content and unsaved-edit conflicts remain owned by the document workflow. Worktree creation,
Space binding, asynchronous busy state and session recovery keep their existing owners and semantics.

## Validation

The theme must preserve theme normalization and reload behavior, existing light/dark appearance,
clear keyboard focus/error states, and Control Center usability. Pixel canvas checks cover transparent
hit testing, stable viewport/geometry, real terminal input/output and reduced-motion cleanup.
Terminal Find and theme changes must preserve the terminal instance, body size, rows/cols and Worker
geometry; existing terminal continuity tests remain part of validation.

For large workspaces, evaluate drawing cost and input latency with realistic node/output loads before
raising the visual budget. Precise tool-level effects and text-frontier effects require trustworthy
structured events or renderer APIs; they must not be inferred from CLI text.
