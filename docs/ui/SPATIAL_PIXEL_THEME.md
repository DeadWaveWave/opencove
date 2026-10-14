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
Terminal, Task, Note, Document, Role, Website and Image use one family of decorative line icons.
Agent windows use their resolved provider's identity glyph, including terminal Agent overlays.
The existing presentation owner supplies the provider; titles are never parsed to guess a brand.
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

Appearance exposes three independent, persisted boolean preferences:

- `canvasPixelBackgroundEnabled`: animated field and brief received-output edge activity. Off uses
  the standard canvas dot grid.
- `nodeCreationPixelEffectEnabled`: transparent assembly, converging fragments and virtual pixel rim.
- `nodeClosePixelEffectEnabled`: square fragments scattering from a successfully closed window.

The settings owner normalizes missing preferences to on for Pixel-family settings and off for other
legacy themes. Explicit choices survive theme changes and reload. Theme switching changes colors,
not preferences, and never replays creation or closing. Turning off an effect clears only its own
visual state immediately. With all three off the effect layer is unmounted; with only creation/close
enabled it schedules frames only while those effects are active. Pixel Space zoom detail is material
state and remains independent of these optional effects.

Shared `--cove-pixel-*` tokens follow the applied theme: Cove maps them to its generated knowledge
blue, accent cyan and shell green, with the cyan one step darker in light mode to keep 3:1 on
surfaces. Pixel retains its original ice-blue/cyan/mint palette. System follows the resolved light/dark palette. No pixel color encodes
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
