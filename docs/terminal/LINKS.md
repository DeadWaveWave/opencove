# Terminal Links

Terminal links are transient projections of the displayed xterm buffer. Detection, source-aware
resolution, pointer intent and workspace navigation have separate owners. Link handling never
changes the terminal's durable execution directory, session recovery state or canonical geometry.

## Detection and coordinates

The renderer reads a complete soft-wrapped logical line through the public xterm buffer API.
UTF-16 string offsets are mapped to cell columns using each cell's text and width; xterm link
ranges are one-based and inclusive. Every physical row of a link resolves to the same target.
Scanning is bounded to 200 rows and 20,000 characters. An incomplete over-budget candidate is
not offered as a truncated link. Hard newlines are boundaries: indentation or trailing slashes
alone are not sufficient evidence to concatenate independent output.

URL and file detectors produce candidates without IO. Complete quoted/compiler paths take
precedence over overlapping partial paths. Raw filesystem percent characters are preserved;
only file URIs undergo URI decoding. Detected links and native OSC 8 links use the same action
owner, and OSC 8 hover shows the target address rather than trusting its visible label.

## Source context and resolution

The terminal's worker binding determines endpoint and mount. The current visual Space never
changes the identity of a path emitted by another runtime. Files are verified through the
existing filesystem Control Surface, preserving approved-root and mount-root checks. A missing
remote transport cannot fall back to the local filesystem.

OSC 7 directory observations are scoped to normal-buffer markers and the source host/platform.
They are runtime observations of the displayed stream, not durable cwd facts. Historical rows
retain their own observed directory. Snapshot replay is suspended from observation; clear,
reset, reflow, alternate-buffer transitions and source changes invalidate observations. An
unknown/foreign host cannot redirect path interpretation. Shells which do not emit OSC 7, and
restored output without directory observations, use the launch directory only as a candidate
requiring explicit confirmation. No shell prompt text is parsed to infer cwd.

The existing endpoint home-directory query may include a source hostname. Older workers can
omit it; unverified home/host metadata stays unknown. These optional fields require no stored
workspace migration. Host platform metadata does not provide a WSL path translation contract;
paths inside WSL are not translated into Windows host paths by this resolver.

## Actions and lifecycle

Hover displays the destination in a status strip at the bottom left of the terminal. Ordinary
single click offers a compact vertical action menu after selection gestures have been excluded.
Its primary action names the destination (browser, file, or directory); Copy is a secondary
header action. Showing the menu preserves terminal focus, Tab enters its actions, and Escape
dismisses it. macOS Command-click and Windows/Linux Control-click open a verified target directly;
adding Shift opens local files with the system default application. Control-click
on macOS, auxiliary buttons, other selection modifiers, double-clicks and drags retain their original
semantics. In mouse-reporting TUIs, ordinary clicks go to the application; an explicit link
navigation gesture is consumed before PTY mouse reporting.

One controller owns a gesture. Ordinary mouseup still reaches xterm's selection cleanup; the
cleared activation draft prevents duplicate navigation. Its consumed-gesture marker also keeps
canvas viewport normalization from interpreting the same action. Providers, DOM listeners,
timers and cwd markers are disposed with the xterm instance. Delayed results must still match
the source session, context and buffer snapshot before displaying or opening a target.

Known web URLs open synchronously in the browser's user-activation stack. A pending file lookup
shows a disabled Open action until resolved. Explicit file opening rechecks the target and
preserves line/column ranges through a transient document navigation request. Escape and Copy
restore terminal focus; successful file navigation owns editor focus. Remote loopback URLs are
not silently opened on the viewer's machine when no forwarding route is available.

## Workspace destinations

Files open through the same document materialization path as Space Explorer. A matching
source mount is required even when the terminal has moved between Spaces. Existing documents
are reused within the matching scope. On Electron, verified local directories open in the system
file manager through the existing approved-path boundary; they do not require a matching Space.
This requires a confirmed local Home Worker, because its `local` endpoint name alone does not
prove that files are on the viewing Desktop.
Remote and Web directory actions navigate a matching Space Explorer and never fall back to the
viewer's local filesystem. Ambiguous destinations do not select an arbitrary Space.

## Regression layers

- Real xterm buffer tests cover Unicode widths, wrapped rows, interval endpoints, quoted paths,
  URI encoding, stale snapshots and bounded input.
- Resolver and contract tests cover source identity, scope failures, old remote metadata and
  launch-directory confirmation.
- Renderer tests cover late async results, browser user activation and editor readiness.
- Electron/Web Playwright tests cover actual mouse clicks, selection, menus, platform modifiers,
  canvas transforms and document line/column navigation.
