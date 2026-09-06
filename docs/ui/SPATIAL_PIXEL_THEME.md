# Spatial Pixel Theme

Pixel is an opt-in dark theme for OpenCove's spatial workspace. It uses deep blue surfaces,
ice-blue-to-cyan-to-mint pixel colors, clear node boundaries, and bounded output activity feedback.
Select it through the existing Appearance theme picker or Control Center. Its node materials stay
theme-specific; pixel background, creation and close effects can independently accompany any theme.
These effects do not change terminal execution behavior.

## Theme ownership

`settings.uiTheme` remains the single source of truth. Pixel is registered through `UI_THEMES`
and `UI_THEME_DESCRIPTORS`, with both `baseScheme` and `terminalScheme` set to `dark`.
Its palette is defined in `src/app/renderer/styles/themes/pixel.css` and consumed through semantic
`--cove-*` tokens. Terminal colors continue through the existing applied appearance snapshot owner.

Node surface color and node material are separate tokens: consumers such as Document Node use the
surface color in `color-mix`, so the surface token must not become a gradient. Node header, input,
resize, selection and Find geometry keep their existing contracts.

All eight node kinds share blue-ink reading surfaces and restrained translucent chrome. Headers are
flat, with low-contrast separators and consistent controls; they have no beveled highlight bands.
Terminal content stays opaque and readable. Images retain their image-first layout with matching
frame treatment. Spaces are lightweight region boundaries, with very faint fill that recedes as the
canvas zooms out. Large Spaces have no broad blur, gradient, shadow or decorative corner patches.
Small title/worktree labels retain a subtle translucent surface. Entity labels and semantic
warning/error colors remain independent of the blue/cyan/mint brand gradient.

## Effect preferences

Appearance exposes three independent, persisted boolean preferences:

- `canvasPixelBackgroundEnabled`: animated field and brief received-output edge activity. Off uses
  the standard canvas dot grid.
- `nodeCreationPixelEffectEnabled`: transparent assembly, converging fragments and virtual pixel rim.
- `nodeClosePixelEffectEnabled`: square fragments scattering from a successfully closed window.

The settings owner normalizes missing preferences to on for legacy Pixel settings and off for other
legacy themes. Explicit choices survive theme changes and reload. Theme switching changes colors,
not preferences, and never replays creation or closing. Turning off an effect clears only its own
visual state immediately. With all three off the effect layer is unmounted; with only creation/close
enabled it schedules frames only while those effects are active. Pixel Space zoom detail is material
state and remains independent of these optional effects.

Shared `--cove-pixel-*` tokens follow the applied theme: dark uses cool blue/cyan/mint, light uses
darker cool colors for contrast, and Ember variants use copper/amber/gold. Pixel retains its original
ice-blue/cyan/mint palette. System follows the resolved light/dark palette. No pixel color encodes
selection, Agent status or success.

## Canvas effects

The pixel canvas is a viewport-sized, read-only visual layer. It draws a continuously moving theme-colored gradient
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
- Keep the visible gradient field moving at the same capped frame rate even when output is idle;
  received-output activity still decays independently after 1050ms.
- Stop drawing when hidden/offscreen without pausing Agent execution or dropping runtime output.
- Render a static field with reduced motion and disable activity particles.
- Discard stale activity on node/session changes and dispose all subscriptions and animation frames.
- Skip filtered-out and offscreen nodes and allocate buffers for the viewport, not the infinite world.

## Node assembly

Local node-creation transactions prepare transparent, instance-scoped CSS masks before committing
new node IDs. The existing successful-created notification remains after the synchronous commit;
failed transactions cancel their prepared styling. Hydration, ordinary updates and theme changes
do not prepare masks or replay creation.

Preparation holds the first frame transparent only until the actual node DOM can be presented.
PTY, editor and media initialization run independently: they never postpone the pixel front or reset
its clock. Slow terminal startup may affect when text arrives, but it does not add a deliberate pause
before the node frame appears. DOM preparation is bounded to 1200ms and then fails open; late mounts
do not replay the effect. The same 380ms visible frame timeline then moves a normalized,
stepped frontier across each node. A wide
node travels farther per millisecond; it does not take longer to complete. Only the traversed portion
of the real node is composited. The foreground canvas draws converging fragments and a virtual pixel
rim along the revealed frame and advancing front, without an opaque veil or placeholder rectangle.
Every window kind uses this same assembly treatment. Masks leave node layout and terminal/editor dimensions intact.
Pointer or keyboard interaction in the main renderer clears masks before existing handlers run,
including pane selection and Tab navigation; programmatic creation autofocus does not cancel it.

Prepared and revealing masks share one deadline function and have cleanup independent of frame
scheduling. Repeated readiness does not restart the reveal. Hidden and
reduced-motion views remove them immediately. There is no history or durable appearance metadata.
Native website contents use the same frontier to clip only the existing host View; full page viewport
bounds, device metrics and zoom remain unchanged. Both decorative canvases keep one scheduler and
stay below controls/transient UI, with no pointer interception.
Input in the revealed native browser region retains its existing routing while the reveal completes;
the application does not forward clicks on still-invisible page controls.

## Node close burst

Successful local close commands publish removed node IDs after the synchronous state commit.
The existing close owners retain all authority over confirmation, task relations, native browser/image
cleanup, PTY termination and persistence; none of those operations wait for animation. Missing-node
closes, canceled deletion and hydration do not publish this notification.

The pixel layer hands off the last visible world rectangle across that commit for at most 160ms,
retaining at most 256 geometry records. It then draws a 420ms radial burst: a fast initial snap,
followed by drifting square fragments that shrink and fade. There is no circular ring or outline.
The burst uses the applied theme's pixel gradient, tracks the current viewport, and never captures document or terminal text.
At most eight bursts run concurrently, with bounded fragments and no deferred playback queue.

The original node is already removed while fragments remain. Ordinary pointer/keyboard interaction
does not cancel this nonblocking burst; it still immediately clears assembly masks on surviving nodes.
Hidden/reduced-motion views clear both effects. Changing projects remounts only the background
decoration, leaving the existing node, terminal and viewport lifecycle owners intact.

## Interaction boundaries

The illuminated active-window border follows real input focus (`:focus-within`), independently of
canvas batch selection. Successful local creation can focus the window's primary input; it must not
add selected IDs or show a batch-selection count. Terminal/Agent autofocus remains owned by their
existing runtime. Other editors activate through the canvas interaction owner, independently of
effect settings, with pending activation canceled by subsequent user input or workspace disposal.
Hydration and theme changes never steal focus. Read-only windows may focus their frame without
entering the normal Tab order. The decorative layer never owns focus or selection.

The website showcase contains scripted mouse actions, timed tool calls, illustrative test results and
an input-blocking node reveal. These behaviors are not part of the application theme. In particular,
application effects never delay operability, interpret ANSI text as tool events, or auto-open documents.

File content and unsaved-edit conflicts remain owned by the document workflow. Worktree creation,
Space binding, asynchronous busy state and session recovery keep their existing owners and semantics.

## Validation

The visible field must change between frames without requiring PTY output. Reduced-motion frames
remain deterministic. E2E evidence includes transparent first paint, real node creation, comparable
visible reveal times at different node widths, input inside the unrevealed area and natural completion,
plus reload without replaying old-node assembly. Native website host clipping must preserve page size.
Close E2E evidence checks that the original node is absent while pixels are painted, surviving nodes
remain usable, cancellation does not burst, and reduced motion removes nodes without decoration.

The theme must preserve theme normalization and reload behavior, existing light/dark appearance,
clear keyboard focus/error states, and Control Center usability. Pixel canvas checks cover transparent
hit testing, stable viewport/geometry, real terminal input/output and reduced-motion cleanup.
Preference checks cover independent toggles, reload, cross-theme color changes and all-off cleanup.
Creation activation checks assert the real focused input and an unchanged batch-selection count.
Terminal Find and theme changes must preserve the terminal instance, body size, rows/cols and Worker
geometry; existing terminal continuity tests remain part of validation.

For large workspaces, evaluate drawing cost and input latency with realistic node/output loads before
raising the visual budget. Precise tool-level effects and text-frontier effects require trustworthy
structured events or renderer APIs; they must not be inferred from CLI text.
