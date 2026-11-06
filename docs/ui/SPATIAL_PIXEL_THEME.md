# Spatial Pixel Theme

Pixel is an opt-in theme family for OpenCove's spatial workspace. Pixel uses deep blue surfaces;
Pixel Light uses cool paper surfaces, dark ink text and deeper blue/cyan/mint accents. Both share
clear node boundaries, solid Space corner brackets and bounded output activity feedback.
Select it through the existing Appearance theme picker or Control Center. Its node materials stay
theme-specific; pixel background, creation and close effects can independently accompany any theme.
These effects do not change terminal execution behavior.

## Theme ownership

`settings.uiTheme` remains the single source of truth. Both are registered through `UI_THEMES`
and `UI_THEME_DESCRIPTORS`: `pixel` uses dark UI/terminal schemes and `pixel-light` uses light
UI/terminal schemes. Their palettes are defined in `styles/themes/pixel.css` and `pixel-light.css`,
with shared material rules in `pixel-material.css`, and consumed through semantic
`--cove-*` tokens. Terminal colors continue through the existing applied appearance snapshot owner.

Node surface color and node material are separate tokens: consumers such as Document Node use the
surface color in `color-mix`, so the surface token must not become a gradient. Node header, input,
resize, selection and Find geometry keep their existing contracts.

Pixel Light retains the same default color stripe, label semantics, focus distinction and Space
geometry. It supplies darker effect colors for visible particles on a light canvas. Its ordinary
terminal and Monaco editor use light reading surfaces; explicit dark terminal mode keeps its own
dark scope. Switching either direction must preserve live terminal/editor instances and dimensions.
Its 16 ANSI foreground colors are tuned for the light terminal surface. These optional colors travel
through the same revisioned appearance snapshot as the background and cursor, including OSC palette
queries. Returning to Pixel or explicitly using a dark terminal removes the light ANSI overrides.

All nine node kinds share blue-ink reading surfaces and restrained translucent chrome. Headers are
flat, with low-contrast separators and consistent controls; they have no beveled highlight bands.
Terminal content stays opaque and readable. Images retain their image-first layout with matching
frame treatment. Spaces are lightweight region boundaries, with very faint fill that recedes as the
canvas zooms out. Large Spaces have no broad blur, gradient, shadow or decorative corner patches.
Space titles, branches and worktree metadata use lightweight text and line icons on the frame,
with an interaction surface only on hover/focus. Entity labels and semantic
warning/error colors remain independent of the blue/cyan/mint brand gradient.

## Color identity and lightweight chrome

All windows have a theme-colored border and fading header stripe, even without a label. The three
theme pixel-palette stops supply this default decoration, independently of the optional animation
settings. It never adds a label attribute, changes the explicit color inventory, or persists a label.
Explicit labels replace those theme stops; clearing a label restores the default theme decoration.

All themes share the same presentation of explicit label colors. The existing label-color owner
projects its resolved color onto the React Flow wrapper through `data-cove-label-color`; it does not
change label inheritance, filtering, selection, geometry or persisted data. Removing the label removes
this presentation attribute, so old tint cannot remain on the frame.

A restrained tint fades across the header while reading surfaces retain their theme colors.
Terminal, Task, Note, Document, Role, Website and Image use one family of 9×9 pixel glyphs in their
kind colour. Agent windows, including terminal Agent overlays, draw their resolved provider's brand
mark in the AI kind colour instead (owner, 2026-11-06): the vendor reads at a glance and the colour
still names the kind. This applies to the header, the collapsed icon, the far tile, the sidebar and
the command center. `resolveAgentPresentationProvider` supplies the provider; titles are never
parsed to guess a brand, and an Agent without a known provider shows the AI pixel glyph. Provider
chips that pick a provider (the dock, settings, task sessions) keep the vendor's own colour.
Plain terminals retain the terminal icon. Image's icon and stripe are overlays, preserving its
image-first layout. Header titles use medium weight, with existing sizes, action targets and terminal
body geometry preserved.

Space identity is visible in its fine colored contour, four solid corner brackets and approximately 2.5% label-color
fill at normal zoom. Its large-area tint recedes toward 0.5% in the far view. Bounded annotation and
stroke compensation keep overview labels and edges recognizable without allowing a small Space's
caption to spill over neighboring regions. This is shared presentation state derived from the canvas
zoom, independent of optional pixel effects.

Title, Files, menu, branch and collapse controls sit on the frame's top edge. The shared caption
measurement cuts the painted border around each control, including collapse actions. The four short
corner brackets retain their solid stroke. No extra inner-header height is added to the frame or
drag geometry. At overview zoom, Files uses its icon while controls retain accessible names and
keyboard access.

Individual collapsed windows become desktop icons with a title and single-click expansion.
Agent icons show their provider identity and a flowing pixel status matrix, without a message
preview. Waiting uses a slow pulse; a plain terminal's matrix animates briefly only after real output.
Status text remains available on hover and to assistive technology, including when working effects
or motion are disabled. These icons replace the full
window side-stream effect while collapsed; runtime size and lifecycle stay unchanged.

A collapsed Space is a compact frame with one clickable icon for each contained window, including
descendant Spaces' windows. Agent icons retain provider identity and use the shared authoritative
runtime status projection. A plain terminal shows session Running/Exited/Connecting; this is not a
claim that a shell command is busy. Clicking an icon reveals its Space and target window without
changing other windows' individual collapse preferences. The header's collapse-and-arrange action
is independent from collapsing the Space and offers an explicit undo.

Input focus remains a separate full-frame highlight using the existing theme focus tokens. The label
stripe and header tint remain visible while the focused frame lights up. Color identity must not
create batch selection, hide dirty/error indicators or change terminal/editor colors. Controls,
context menus, branch actions and title editing retain their original behavior and accessible names.

## Effect preferences

Appearance (and the Control Center) expose these persisted preferences:

- `canvasBackgroundStyle`: `pixel` (the pixel wall, the default), `minimal` (「简约」: the neutral
  dot grid, still until an event, with output ripples through its dots) or `off` (「关闭」: the dot
  grid with no background effects). It replaces the old `canvasPixelBackgroundEnabled` switch,
  read once at load: on becomes `pixel`, off becomes `off`. A theme whose background effect is not
  `pixel` keeps its own background (or none) under `pixel`; its custom background never runs
  under `minimal`.
- `canvasBackgroundTwinkleEnabled` (「背景闪烁」, default on): twinkle and cloud drift on the wall.
  Off, the wall holds still and paints only when the view or a window changes. Only applies to
  `pixel`.
- `nodeCreationPixelEffectEnabled`: transparent assembly, converging fragments and virtual pixel rim.
- `nodeClosePixelEffectEnabled`: square fragments scattering from a successfully closed window.

The settings owner normalizes missing preferences to on (and `pixel`) for Pixel-family settings and
off (and `off`) for other legacy themes. Explicit choices survive theme changes and reload. Theme switching changes colors,
not preferences, and never replays creation or closing. Turning off an effect clears only its own
visual state immediately. With all three off the effect layer is unmounted; with only creation/close
enabled it schedules frames only while those effects are active. Pixel Space zoom detail is material
state and remains independent of these optional effects.

Shared `--cove-pixel-*` tokens follow the applied theme: Cove maps them to its generated knowledge
blue, accent cyan and shell green, with the cyan one step darker in light mode to keep 3:1 on
surfaces. Pixel retains its original ice-blue/cyan/mint palette. System follows the resolved light/dark palette. No pixel color encodes
selection, Agent status or success.

## Pixel wall

The wall is the canvas background (Tide phase 5.2): a grid of cells with seams, anchored to the
world, under every window and the effects layer.

- Cells stay 13–26 screen px: the 24 world px cell doubles or halves as the zoom crosses a step.
  The step does not jump: each new cell flips from the old grid's colour at its centre to its own
  at its own moment within 120ms (5.3d); reduced motion switches at once.
- Colours come from `--cove-pixel-cell`, `--cove-pixel-gap`, `--cove-pixel-cloud-1…4` and
  `--cove-pixel-spark-1…4` (generated for Cove, hand-set for Pixel; plugin themes inherit them
  from their base). Soft clouds drift with the world; their hue blends continuously between
  neighbouring cloud colours (never a hard edge between two clouds) and drifts slowly. Bright
  patches wander across the open wall (shimmer, `PIXEL_WALL.shimmerA`); about one cell in six
  twinkles, more of them near working or waiting windows. Shimmer and twinkle never enter
  glass. Cursor illumination follows the ambient setting: off with twinkle or reduced motion,
  including in showcase mode. It lights the finished tile after work light and ripples, before
  the glass cap. Both appearances use accent step 9 (`--cove-pixel-spot`); Pixel falls back to
  its public accent. Dark walls are lit additively (screen), so a kind-lit tile turns brighter
  and its hue moves part of the way toward the accent: the two lights mix instead of one
  covering the other. Light walls keep Tide's tint toward the accent (owner, 2026-11-06: the
  light-mode tint reads clean; the old dark-mode white did not). Strength 0.45 dark matches the
  old white spot's peak luminance change within 15%; light keeps Tide's 0.2.
  The radius remains 400 CSS px and the Gaussian denominator 52000. A 48px Gaussian fade
  reaches zero at the original frame, with no contribution inside. In glass and chrome only
  the remaining I6 budget is available; its influence eases in outside the glass band too.
- Clouds, hue and shimmer keep fixed world sizes (640, 1150 and 300px); merging or splitting
  cells resamples the same colour field. Twinkle retains its 16% share plus active-window
  nearness at every level. Work-light falloff uses `max(80, 29.25 / zoom)` world px: continuous
  across levels, unchanged at zoom ≥ 0.5, and visible beyond window frames in far view.
  Tile jitter remains bounded to 5/9 RGB levels (dark/light); the two-cell glass band stays
  level-based for contrast protection. Neither changes the open-wall colour field.
- Behind a window's glass, including a two-cell ring around its frame, a cell moves at most the
  generator's `PIXEL_WALL.cap` toward any colour (I6), the bound the theme contrast checks assume.
- Work light (5.3b): the cells around each window take its kind colour (`--cove-wall-light-*`:
  the kind solids in Cove, label colours in hand-written themes, neutral with window kind colours
  off). Dark themes spread the light out from the window; light themes cast it to the lower right,
  as daylight through coloured glass: offset `(0.09w + 30, 0.12h + 44)` world px,
  with falloff `max(30, 13.65 / zoom)`. Glass and active nearness use the original frame.
  Daylight tiles have 9-channel jitter and a 14-channel top-left to bottom-right screen gradient;
  the brightest 5% of twinkle candidates flash white, at strength 0.9 (dark remains 0.85).
  Strength follows the window: idle 0.46 (not an agent),
  standby 0.6, working breathing between 0.64 and 0.92, a flash on received output, a flare to
  full when a run finishes (seen live; a reload never flares), waiting yellow and failure red.
  It is derived per frame and never stored (I7). It keeps breathing with twinkle off; reduced
  motion holds it at a fixed level. The glass cap applies after it.
- Frosted glass (5.3c): behind every window the cells are not drawn sharp. WebGL samples the same
  cell texture with linear filtering (about half resolution, smoothly scaled) inside each
  window's rounded frame, with a very faint grid on top, in one instanced pass; Canvas 2D draws
  the same with a smoothed, clipped image. Twinkle only happens in blank space and never enters
  the glass.
- The CPU computes one colour per visible cell; WebGL2 draws cells and seams in one pass. When
  WebGL2 is unavailable or software-only (`failIfMajorPerformanceCaveat`) Canvas 2D draws the
  same cells. When the context is lost, the 2D canvas shows a still wall until the browser restores
  the context, then WebGL takes over again. The wall uses one WebGL context and releases it on
  unmount.
- Ambient motion follows the decorative scheduler: 30fps focused, 10fps in the background, none
  while hidden or with reduced motion (a still wall). A pan, zoom or window move repaints on the
  next display frame so the wall never trails the windows.
- First frame (5.5): the wall host itself paints a static CSS grid of the theme's cells and seams,
  aligned with the cells of the view it mounts in, so the first paint already shows cells and the
  first WebGL frame continues the same grid instead of replacing a flat colour.
- The wall fills the app window and the shell floats on it (Tide 应用外壳). The app shell owns an
  empty layer (`.app-shell__wall`, `ShellWallLayerContext`); the canvas's wall portals its host
  there and stays the only writer of what it paints. The flow transform is measured from the
  canvas, so the wall adds the canvas's offset in the window (`placeWallViewport`); a world point
  stays under its window while the sidebar opens, closes or turns into the rail. Everything outside
  the canvas is chrome (`resolveWallChrome`: the top bar and the sidebar, in any layout): the wall
  frosts it square-cornered, caps its cells like those behind windows and keeps twinkle and the
  shockwave crest out of it. With a wall in the layer the top bar, sidebar and project rail are
  `--cove-surface` (the generator's `--cove-glass-chrome` tint, contrast-checked against the
  capped wall) with no backdrop-filter, lit like window glass by `--cove-chrome-background-image`
  (the glass sheen fading over 60% of the height, over the glass grain; `none` in Pixel); the
  peeking sidebar keeps its own surface. Without a wall
  (「简约」, 「关闭」, a theme's own background, no project) the layer is empty and the shell keeps
  its usual surfaces. The layout never changes. Outside the app shell (no layer) a wall stays inside
  its canvas.
- The settings page is one sheet of glass over the wall: `--cove-surface-strong` (the generator's
  `--cove-glass-sheet`, 72% dark, 80% light, contrast-checked against the capped wall) with its tab
  strip, panel, navigation and content transparent. While it covers the canvas it tells the shell
  (`useCoverShellWall`), and the wall frosts and caps all of itself and draws no window glass; the
  focus-zoom preview uncovers the canvas and keeps its own transparent look.
- E2E reads `window.__opencovePixelWallTestApi` (frame counts, a cell checksum, mean colour, the
  glass and chrome rects) and the host's `data-cove-wall-renderer` / `data-cove-wall-state` /
  `data-cove-wall-cell`.

## Showcase mode

For screen recordings and demos (Tide 6.1): the command center's "Enter Showcase Mode" or the
control center's switch hides the top bar, sidebar, canvas HUD, zoom controls and minimap, and the
canvas fills the window. The canvas shows the pixel wall whatever the saved background, the wall
keeps moving at the decorative frame rate even with twinkle off, and its clouds drift four times
faster; reduced motion still holds it still. Esc (when nothing open uses it first) or the same
command leaves. It is session state with one owner (`showcase/showcaseMode.ts`, which marks the
document with `data-cove-showcase`): nothing is saved, the layout returns exactly, and a restart
starts without it. A short hint says how to leave, then fades.

## Output ripples

Plain terminal output (the PTY event hub) sends a ripple out from the window's centre (Tide phase 5.4a):
a true circle whose wavefront brightens the wall cells it passes, or the dots of the 「简约」 grid,
in the window's kind colour, for 1100ms. Rings start at 0.35 times the sending window's short side;
the radius adds `reach * (1 - (1 - t)^2.2)` and amplitude decays by `(1 - t)^1.5`. A Gaussian
band (`exp(-x²)`, width at least 0.8 world cells) reaches 2.5 widths on either side. Output uses
240px reach, 30px width and 0.85 amplitude; sonar uses 200/44/0.45 over 1600ms. Cells mix by
0.8 in dark and 0.72 in light. Lit minimal-grid dots use the strongest wave above 0.06, with
size `1.5 + round(v*4)*0.8` and alpha `min(1, 0.3+v)`, outside windows and shell chrome. Each window starts at most one ripple per 700ms
and the canvas carries at most 24, dropping the oldest when a new wave arrives. Agent PTY repaints send neither output ripples nor output light
flashes; authoritative state drives their sonar, waiting and completion signals. Future ACP message
events may drive agent output ripples. A ripple only means output arrived, never a tool call, success
or completion. It is cut to the visible grid and visits only the cells in its band, so its cost
follows the ring, not the window count. Behind glass the cap still applies. Reduced motion shows
none; 「关闭」 has none. The effects layer no longer draws output sparkles along window edges; it
keeps the status corner marks. E2E reads `getRippleCount()` from the wall probe.

## Waiting for you

A window whose agent waits for you (`resolveAgentPresentation` status `waiting`) sends a yellow
beacon every 1300ms while within 120 screen px of the view (150px reach, 28px width, 0.9 amplitude); reduced motion keeps
only the light. When the window is entirely out of view, an edge beacon (`WorkspaceEdgeBeacons`)
sits where the line from the view's centre to the window crosses a frame inset from the canvas
edges: a titled pill with an arrow, five at most (nearest first) and the rest as one "+N" pill.
A click flies to the window at the current zoom, or 0.6 if further out. Beacons are derived from
agent state and the viewport only; with no waiting windows the component does not follow the
view. The pill pulses gently and holds still with reduced motion.

## Working patrol

While an agent works (`resolveAgentPresentation`), two strings of pixels travel around the
outside of its frame (Tide 5.4b): two trains of eight pixels, spaced 11 screen px apart, with
3.5px heads and 2.5px tails. The path stays 6 screen px outside the frame at every zoom; positions
snap to the canvas DPR (capped at 2). The head advances 240 world px/s with an ID-derived seed,
and the second train starts half the unexpanded world perimeter later. As in the prototype,
the expanded path adds `48 / zoom` world px to a lap. Only windows within a 40px margin participate.
The colour is the kind ink (`--cove-kind-<family>-ink`): step 11 in dark, step 9 in light
(neutral: step 10 / 9); Pixel themes fall back to their blue/cyan/mint palette. Every 2.4s it also sends a low sonar wave across the wall, or through the 「简约」
dots. Wall sonar includes windows within 200 screen px of the view. Both follow the Agent working effect switch; 「关闭」 has no sonar. Reduced motion keeps a
static 1px frame highlight and no waves, following the spec table’s reduced-motion promise
(the prototype drawFx itself skips the patrol). Turning signals off removes the highlight too.

## Finished and failed runs

`WorkspaceWindowSignals` is the one owner of these signals (Tide 5.4d). It watches
`resolveAgentPresentation` and only counts transitions seen live (a reload never signals):

- A run finishing (working → standby), at most once per window per 3s: the window's frame flashes
  in its kind colour and the canvas sheds 26 ink sparks from random perimeter points (speed 260,
  base life 700ms); the wall sends a strong shockwave whose
  white crest stays outside windows and their one-cell margins (behind glass only the kind colour
  shows, within the cap). Both last 2100ms; the kind wave uses 860px reach / 56px width / amplitude 1,
  the crest 900/22/0.95 with a 0.92 mixing weight. As
  the shockwave passes another window, that window's 1px edge glows in the sender's colour for
  half a second.
- A change into failed: the frame jolts sideways in a 280ms glitch; the canvas sheds 14 red sparks
  (speed 150, base life 560ms, gravity 320), and the
  wall sends a red ripple over 820ms, with 190px reach, 26px width and 0.95 amplitude.

Frame signals write one attribute (`data-cove-signal`) and one colour variable on the window, only
while they last, and never touch the fill behind its text. They follow the Agent working effect
switch. Reduced motion: the frame's colour flashes once and a failure keeps a still red outline;
no waves, sparks or glitch.

## Canvas effects

The effects canvas is a viewport-sized, read-only visual layer above the wall. It draws creation,
closing and working effects, LOD/completion/failure sparks, status corner marks, and the 「简约」 dot ripples. The ripples are
drawn first, under the patrol and the sparks, as the prototype's dot canvas sits under its effects canvas. It paints no ambient
background (the older ridge and scan-line field is retired) and requests no frames while idle.
It retains only bounded session/timestamp observations, not output text or persisted application state.

Agent identity and status use `resolveAgentPresentation`, including normal terminal nodes with an
Agent overlay. `working`, `waiting`, failure and degraded observation retain their existing meanings.
Received output does not establish a tool category, newly generated text, success or task completion.

The layer must:

- Be `aria-hidden` and `pointer-events: none`; never enter keyboard focus order.
- Read existing viewport, node geometry and session references; never write them.
- Stay outside the terminal body and never resize or remount xterm/Monaco.
- Coalesce output bursts into the decorative scheduler (30fps focused, 10fps in the background) at
  DPR 2.
- Plain terminal output sends a ripple (below); an idle layer requests no frames.
- Stop drawing when hidden/offscreen without pausing Agent execution or dropping runtime output.
- Disable activity particles with reduced motion.
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

Collapsed windows use a desktop-icon presentation. Their compact 128px-wide drag/click bounds stay
transparent, including on hover and keyboard focus. Hover highlights only the icon pedestal;
canvas selection highlights the pedestal and a title-sized caption, independently of label color
and runtime status. Keyboard focus draws a local icon ring. Selections containing only collapsed
windows retain their geometry for dragging without painting the enclosing group rectangle;
mixed or expanded selections keep their existing frame. Pixel corners indicate runtime status,
with its text available on hover and to assistive technology rather than as a separate row.
All node kinds use the same 112×96 compact presentation and collision bounds. Collapsing an Agent
does not read or poll its latest message; its message-copy action remains independent. Presentation
and collision bounds share the same compact size helper. The compact presentation has no floating Close button: its context menu delegates
Close to the mounted runtime's original guard. Single-click expansion and collapse geometry are
unchanged, and visual feedback must not offset the icon/title animation anchors.
The compact title's selected paint remains measurable after disclosure changes state; the motion
owner interpolates its text, background and caption shadow into the header. Both the first animated
frame and final handoff must match the visible title, including when the compact icon is selected.
Agent header and compact captions use the same provider-free display label alongside the brand
icon. Known generated provider prefixes are stripped only for display, including legacy renamed
titles; the stored title and its owner remain unchanged.

Files and folders share one decorative Lucide identity resolver across Explorer entries, window
headers and compact nodes. Directory entries always use Folder; file basenames select FileJson,
FileCode2 or the conservative FileText fallback. The resolver does not read content or claim a MIME
type. Header and compact glyphs keep the same stroke and existing animation anchors. File/folder
compact nodes use a lightly tinted pedestal with two diagonal pixel corners, retain the shared
112×96 interaction bounds, and display only the name beneath the icon. They never add a parent-path
row, a floating Close control or a surrounding hover box. Their temporary motion surface and settled
pedestal share the same theme tokens; Agent and terminal status corners remain unchanged.

Expanded directory windows show their current location in a bottom footer with slash-separated,
clickable breadcrumbs bounded by the originating project or Space root, without a separate parent
button. The current breadcrumb scrolls into view when the path or available width changes. The
Explorer title shows the Space name at its root and the current directory name below it, without a
second Space identity beside the title. Folder windows always use their current directory name.
The header places view switches immediately before Close. A compact single-row toolbar expands search
on demand; insufficient space temporarily fades out the other tools until search loses focus.
Navigation preserves the chrome and content containers rather than remounting the window. Icons and List are
two presentations of that same directory: Icons uses a fixed, directory-first natural-name grid;
List uses expandable hierarchy rows. View mode and expanded-directory preferences never rearrange
or move files on disk. Navigation updates the window's title and compact identity to its current
directory; collapsing retains that location and browsing state.

The website showcase contains scripted mouse actions, timed tool calls, illustrative test results and
an input-blocking node reveal. These behaviors are not part of the application theme. In particular,
application effects never delay operability, interpret ANSI text as tool events, or auto-open documents.

File content and unsaved-edit conflicts remain owned by the document workflow. Worktree creation,
Space binding, asynchronous busy state and session recovery keep their existing owners and semantics.

## Validation

The wall must change between frames without requiring PTY output. Reduced-motion frames remain
deterministic, and terminal output never moves a still wall. E2E evidence includes transparent first paint, real node creation, comparable
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

LOD changes shed 10 sparks per visible expanded window in its kind ink (speed 40, base life
260ms). The effects layer reads the LOD attribute from `useSpaceVisualScale` and subscribes to
`windowSignalEvents` for finished/failed runs; it does not infer either transition itself. An
initial/reloaded LOD is not a transition. Signals off, reduced motion, hidden/offscreen canvases
and disposal clear particles without replay; the background setting does not suppress signals.

All three use Tide’s bounded field of at most 1200 particles. Origins and velocities are world
coordinates; speed is multiplied by `0.5 + random()`, life by `0.7 + random() * 0.6`, size is
`2 + random() * 2.5` screen px multiplied by `clamp(zoom, 0.55, 1.2)`. Exponential drag 2.4
integrates from the event timestamp, gravity is analytic, and alpha is `(1 - age / life)^1.2`.
The existing 30fps focused / 10fps unfocused / 0 hidden scheduler owns their frames. No CSS
corner sparks remain; the frame flash and failure glitch retain their existing owner and timing.
Creation/close assembly and burst retain their existing blue/cyan/mint gradients; their colour
port is separate from these kind-ink signals. The wall’s glass cap is unchanged.
