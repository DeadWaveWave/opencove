# Changelog

All notable changes to **OpenCove** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🚀 Added

- Give supported local Claude Code and Codex agents a short OpenCove canvas guide at session start, with a Suggest/Off setting under Agent.

- Plugin themes: a theme can declare four inputs (light or dark, a base tint, an accent colour and contrast) instead of individual colours, and OpenCove generates the whole palette with the same checked contrast as its built-in Cove themes. (#477)
- CLI: `opencove` is rebuilt for AI agents and scripts: grouped help with examples, compact JSON on stdout with `--fields` selection that keeps the response shape, optional table output, `--limit` for lists, `--<option>-file <path|->` for long values, actionable errors on stderr with typo and close-name suggestions, and stable exit codes. `opencove api ops`, `api schema` and `api call` discover and call every Control Surface operation, most of them with a described input schema. (#521, #524, #525, #529, #532, #538, #551)
- Agents and terminals started on the canvas know which node, Space and project they belong to and get `opencove` on their PATH with a session-lifetime token for permitted API operations (project isolation is not yet enforced); inside such a terminal `opencove whoami`, `opencove context` and `@self`, name and ID-prefix selectors let an agent orient itself. (#528, #540)
- Agents can hand work to each other: `opencove agent prompt` pastes a prompt into an agent window OpenCove launched (Claude Code, and Codex with lifecycle hooks), confirms that the agent received it and says whether the submitted text matches what was sent. A prompt to an agent that is working steers it within the current turn (`--expect-turn` targets one running turn); it refuses without sending anything while the agent waits for an answer to a dialog. `opencove agent delivery <id> --wait` follows each delivery and nothing is ever sent twice. `agent wait --turn` waits for that prompt's turn and `agent read --turn` returns its reply, also after OpenCove restarts (the last 60 turns per agent are kept for 30 days; `opencove agent history clear` deletes them without deleting the agent, and deleting the node removes them too); `agent list`, `agent get` and `agent read --screen` complete the loop, and `opencove skill` prints a usage guide matching the CLI version. (#544, #549, #550, #553, #554, #556, #563, #566, #570)
- CLI: `opencove agent prompt --wait --read` hands work to another agent in one command: it sends the prompt, confirms delivery, waits for that prompt's turn and returns the reply. Exit codes match `agent wait` (10 when the agent waits for the user, 11 when it exits, 124 on timeout), one `--timeout` covers confirmation and the wait, and every error keeps the delivery and turn IDs so the caller can continue without resending. (#594)
- Agents: `opencove agent read --turn` returns the reply of that exact turn for Codex agents too, so prompt → wait → read works with Codex workers; steering input and Codex subagents never move a reply to the wrong turn. (#589)
- CLI: `agent read` and `agent wait --turn` list the deliveries and provider prompt IDs that belong to the turn; `node list` and `context` show whether an agent is working separately from whether its session runs, and which task it belongs to (`taskNodeId`); prompt, wait and read help is shorter, with the details in `opencove skill`; creating a task with a frame below the minimum size reports the size used. (#572)
- CLI: agents can create nodes on the root canvas, outside every Space, with `opencove node create <kind> --root-canvas`; the node is placed next to the calling terminal or its Space. With no target, `node create` and `node list` use the Space the caller is in now, or the root canvas when its terminal is outside every Space, and `node list --root-canvas` lists only nodes outside Spaces. (#581)
- CLI: `opencove node create agent --prompt … --wait --read` starts an agent and returns its first reply in one command, with the same exits as `agent wait`; errors keep the node, session and turn IDs so the caller can continue without starting a second agent. `agent prompt` now prints neutral progress lines (`Sending prompt …`, `Waiting for turn …`) instead of warnings while it works. (#598)
- CLI: an agent started by another agent can report back with `opencove agent prompt --node @parent --wait --read`. OpenCove records which agent created each node and how deep it is (`spawnedBy`, `lineageDepth` in `node get/list`, `agent get/list` and `context`), `node list`/`agent list --spawned-by @self` show the agents you started, and `node create agent --help` lists the accepted providers. (#597)
- CLI: `opencove space update --space <selector>` renames a Space (`--name`) or changes its boundary (`--frame`, any of x/y/width/height). Members and child Spaces never move: the boundary grows to keep them inside, ancestors grow when needed, and an adjusted frame is reported. Agents in OpenCove terminals may use it. (#595)
- CLI: `opencove space create` makes a Space in your project, or a child Space with `--in` that can take nodes with `--move`; `opencove project add` adds a project, and agents in OpenCove terminals are told to ask the user instead. (#588)
- CLI: agents keep the names they are given (`node create agent --title …` is no longer replaced by the automatic session title), `opencove node update agent|terminal --title` renames them, and `opencove agent stop --node <selector>` stops a running agent without deleting its node. (#584)
- Agents that OpenCove launches (Claude Code and Codex) learn at session start that they are running in OpenCove: a short fixed guide suggests posting results as notes, marking finished tasks `ai_done` and asking before starting other agents. Turn it off in Settings → Agent → Tell agents about OpenCove. (#585)
- Control Surface: create projects and Spaces, so a headless Worker can be set up from the CLI. (#526)
- Control Surface: address agent and terminal sessions by canvas node, including sessions opened from the UI or restored after a restart. (#527)
- Control Surface: read an agent's run state (`agent.get`, `agent.list`) and subscribe to state changes and completed turns, decided once by the Worker that runs the agent. (#533)

### 💅 Changed

- Sync: every window and browser tab catches up after reconnecting, including after the Worker restarts, and changes the Worker makes on its own now reach every open window. Deleting or moving windows while a refresh is in flight is no longer undone. Opening and saving workspaces keeps working with older Workers; only features that need a newer Worker say so. (#602)
- Persistence: every window and browser tab now agrees with what was actually saved. When a save is corrected, merged or its result is unknown, OpenCove refreshes from the saved state and keeps your newer edits instead of assuming its own copy was stored; quitting waits for your last edits to be saved within a short limit; importing a workspace can no longer be undone by a pending autosave; and reordering Spaces or panning no longer looks like a conflict. (#601)
- Agents: agents in OpenCove terminals can start at most 6 running agents or terminals per tree of agents they started, and no deeper than a grandchild of an agent you started; the refusal says how to free a slot. Agent terminals now start agents and terminals only with `opencove node create`, so a standalone `session run-agent` session can still read and write notes but asks you to start a canvas agent before it delegates. Agents and terminals you start yourself, task runs and restarts are never limited. (#600)
- Agents: every Claude Code agent window launch, relaunch, conversation switch, role or task run and restart now goes through one Worker owner that records which conversation the window resumes and cleans up exactly the processes it replaced. Running a role now gives its agent window its own identity. Ownership itself stays off until the remaining client work ships. (#599)
- Persistence: the Worker can now own an agent window's Claude resume binding. Once it does, saving the workspace from a stale window or browser tab can no longer change which conversation that agent resumes after a restart. No agent uses this yet; it is the groundwork for resuming the right conversation after `/clear`. Saves also report the exact revision they wrote. (#596)
- CLI: errors say whether repeating the command can help (`retryable`, true only for a refused connection or a read or wait timeout) and list ambiguity candidates at `error.candidates`; `node list` and `agent list` show 50 rows by default with `truncated`/`total` (`--full` for all); `agent read --scrollback` reads terminal history; create commands accept `-q` to print only the id; and standalone `session run-agent` keeps CLI access without a made-up node identity. (#592)
- CLI: `opencove skill` prints a short guide and `opencove skill canvas|coordinate|wait|read|access` the details, so agents load only what they need; the guide teaches prompt → confirm → wait for that turn → read it, background waits for Claude Code coordinators, `whoami` as the identity check and giving a delegated agent its own worktree. CLI and agent docs match the current behavior. (#590)
- Agents: OpenCove says why an agent is waiting. `agent get`, `agent list` and the `agent wait` attention error report whether it needs approval, has a question (with the question and options) or has a plan for review, and the reason no longer disappears while the dialog is open. In the sidebar, agent island, collapsed windows and edge beacons, blocked agents say what they need, and agents that finished their turn say Finished instead of waiting. (#587)
- CLI: `opencove agent wait` stops with exit 10 when a target agent is waiting for the user (a permission, question or plan dialog) and with exit 11 when it exits, instead of waiting until the timeout; the error lists each target's state and tells the coordinating agent to ask the user. `--through-waiting` keeps the old behavior. (#582)
- Canvas: the pixel wall's colour clouds blend smoothly from one colour into the next instead of meeting at hard edges; bright patches drift across the open wall, twinkle gathers around working agents, the wall brightens softly under the pointer, and the zoomed-out wall stays calm, as in the Tide prototype.
- Appearance: replace the Standard theme with Cove, whose colors are generated with checked contrast, and use Cove Dark for new installs. Ember is retired and existing Ember choices move to Cove; Pixel is unchanged. (#439)
- Appearance: icon buttons show themed tooltips that follow the theme, appear sooner and also open on keyboard focus. (#442)
- Agent windows: status pills use larger text and reserve color for what needs attention: working uses the accent, waiting is yellow, failed is red and every other state is neutral. (#443)
- Canvas: in far view each window is a kind-coloured tile with a large icon, a bold title and a status pixel, as in the Tide prototype, and every Space name is the same size whatever the Space's width.
- Canvas: the right-click menu shows the keyboard shortcuts for New Terminal, New Note, Run Agent and Create Space with Selected, and screen readers announce it as a menu. (#444)
- Settings and dialogs: switches, checkboxes and task tags use shared controls that follow the theme and have larger click targets; task tags become chips. (#445)
- Dialogs and windows: choices such as the issue type, connection method, plugin source, worktree branch mode and explorer view use one segmented control, which screen readers announce as a radio group. (#446)
- Settings: search finds every row on every page, including update, notification banner, calibration, worker, Web UI, website window, diagnostics and each keyboard shortcut. (#470)
- Sidebar: the project's name is followed by the branch its checkout is on, as in the Tide prototype.
- Sidebar: a Space working in its own worktree shows its branch on its card, next to its working, waiting and window counts. The canvas and the sidebar now share one worktree listing per repository instead of each polling git.
- Sidebar and Command Center: the OpenCove logo leaves the project rail; Focus, Normal and All become one segmented control under the project name; Agent rows read on one line with an AI tile; Command Center windows show their kind tile with the Space on the right, and agents show a status pill. (#484)
- Dialogs: text fields share one labelled field with help text and inline errors; remote machine port errors now appear under the field. (#448)
- Appearance: menus, popovers and the control center share one acrylic material with checked contrast, and turn solid when the system reduces transparency. (#449)
- Settings: every row's label now names its control and its description is read with it; selects also say their current value. Rows, number fields and buttons use the shared components, and the pages keep their layout. (#471)
- Settings: headings are neutral instead of blue, the selected page is a neutral row, each group's rows sit on one card, and the search field is boxed; the theme is a family card plus a Light / Dark / Follow System row, and the Agent page switches views with a segmented control instead of tabs. (#483)
- Showcase mode: for recordings and demos, hide the top bar, sidebar and canvas controls from the command center or control center; the canvas fills the window and the pixel wall drifts faster. Press Esc to leave; it is never saved.
- Control Center: section labels line up with their controls.
- Settings: over the pixel wall the settings page is a sheet of frosted glass, with the wall's colours softly showing through; with solid windows or reduced transparency it stays opaque.
- Canvas and shell: the pixel wall fills the whole window, and the top bar, sidebar and project rail float on it as frosted glass without blurring what is behind them. The wall stays lined up with the windows as the sidebar opens and closes; with solid windows or reduced transparency the shell is opaque, and the layout does not change.
- Canvas: opening a project shows the pixel wall's grid from the first paint, so the wall fades in its colours without a flash. (#498)
- Canvas: while an agent works, two strings of pixels travel around its window's frame, and a faint sonar wave goes out every 2.4 s. This replaces the streams down both sides; with reduced motion the frame keeps a still dotted outline. (#497)
- Canvas: when an agent finishes a run, its window's frame flashes, pixel sparks leave its corners, and a shockwave crosses the pixel wall, briefly lighting the edges of the windows it passes. A failure makes the frame glitch red and sends a small red ripple. Reduced motion keeps a single colour flash, or a still red outline for a failure. (#496)
- Canvas: an agent waiting for you sends a yellow pulse ring across the pixel wall. When its window is out of view, a beacon at the edge of the canvas shows its title and points at it; click it to fly there. Up to five beacons show at once, and the rest fold into +N. (#494)
- Canvas: output from a window sends a ripple out across the pixel wall, or through the dots of the Minimal background, in the window's kind colour. Each window ripples at most every 0.7 s, at most 24 at once, and never with reduced motion. This replaces the sparkles along window edges. (#493)
- Canvas: when zooming changes the pixel wall's cell size, the cells dissolve into the new size over 120 ms instead of jumping; with reduced motion they switch at once. (#492)
- Canvas: behind every window the pixel wall shows through as frosted glass, a soft blur of the cells with faint seams, and pixels only twinkle in the open, never behind a window. (#491)
- Canvas: on the pixel wall each window lights the cells around it in its kind colour. The light breathes while an agent works, brightens on output, flares when a run finishes, and turns yellow while waiting for you and red on failure. In light themes it falls to the lower right, like daylight through coloured glass. (#490)
- Canvas: choose the background in Settings → Appearance or the Control Center: Pixel (the pixel wall), Minimal (a quiet dot grid) or Off. Background Twinkle turns the wall's twinkle and drifting clouds off so it holds still. The old canvas background switch carries over: on becomes Pixel, off becomes Off. The old drifting pixel field and scan lines are retired. (#489)
- Canvas: the pixel background becomes a pixel wall: cells with seams, soft colour clouds and a sparse twinkle in the theme's colours, drawn on the GPU and calmer behind every window so text stays readable. Without hardware graphics it draws with Canvas 2D, and if the GPU resets it shows a still wall until it recovers. (#486)
- Pixel theme: decorative canvas effects keep an even 30 frames a second while OpenCove is focused (a 120Hz display no longer drops them to 24) and slow to 10 when it is in the background, which saves power. (#485)
- Windows: every window header ends with the same collapse and close buttons, in the same order and size, with tooltips; the terminal and agent close button now has a name for screen readers. (#450)
- Windows: terminal, agent, task, note, document, folder, role and plugin windows share one header layout: the kind icon on a small tile, 13px titles, status after the title and evenly spaced controls; the role header is no longer taller than the others. (#451)
- Website windows: the header shows the page title like other windows, and back, forward, reload and the address bar join the browser toolbar below it, where the address stays readable in narrow windows. (#452)
- Windows: content sits on an inset reading plate below the header, with a fine edge; the document editor reads directly on it. (#453)
- Pixel theme: window headers no longer use a live background blur; windows use one tinted frame around the reading plate, which saves GPU work with many windows open. (#454)
- Terminals: terminal text can sit directly on the window's reading plate. Settings → Terminal → Terminal Background chooses Auto (transparent on macOS, opaque on Windows and Linux), Transparent or Opaque; changing it keeps the running shell and its output. (#456)
- Appearance: Window Material (Glass or Solid) in Settings → Appearance and the control center; Solid makes windows, menus and panels opaque and removes every blur, and windows turn solid whenever the system reduces transparency, live, without a restart. The control center now lists Appearance first and opens All Settings with its shortcut. (#480)
- Control Center: quick switches for theme (Cove or Pixel), light, dark or follow system, pixel background, motion signals and the minimap; plugin themes are chosen in Settings, and "Top-right banner" is now "Notification banner" in Settings. (#457)
- Settings: new installs start with agent Full Access off, so agents stay in their sandbox and ask before running commands or changing files; existing choices are kept, and the setting now says what each state means. (#461)
- Top bar: the command entry names the project and the Space you are looking at, and a summary of agents across projects shows how many are working; when any are waiting, one click goes to the first. (#458)
- Command center: ⌘P finds windows (with the Space they live in) as well as Spaces, projects and commands, and lists agents waiting for you across projects first, with how long they have waited; commands show their shortcuts, and while you type, the section with the best match comes first. (#475)
- Sidebar: every project on the rail is a tile in its own colour with its name below, the number of agents waiting on its corner and three moving pixels while its agents work; the OpenCove mark sits at the top and pin, add project and settings at the bottom. (#459)
- Sidebar: a "Needs you" inbox at the top lists every agent waiting for you across projects, with where it is and how long ago it started waiting; one click switches to its project and focuses it. (#460)
- Sidebar: each Space is a card with a live pixel map of its windows in their kind colours, where working agents step and waiting ones turn amber; click a square to fly to that window. The card shows how many agents are working or waiting and how many windows it holds. (#466)
- Canvas: a small HUD shows the zoom at the top right, and a Far / Near switch at the top left fits every window in far view or returns to 100%. (#500)
- Canvas: below 25% zoom each window turns into a tile in its kind colour, with its icon, title, agent status and label, and comes back above 28%. Terminals, editors and pages keep running. Click a tile to fly to its window, drag it to move the window, or right-click it for the window menu. Settings → Appearance → Far View turns it off. (#481)
- Windows: the header's icon tile shows what a window is in its kind colour (agents purple, terminals green, tasks orange, notes and documents blue, websites and images pink), with a light tint on Cove headers, and the canvas minimap uses the same colours; colour labels now draw only the window frame and a short flag, and unlabeled Cove windows keep a neutral frame. Settings → Appearance → Window Kind Colours turns the kind colours off, and plugin windows can choose a kind with `view.kind`. (#478)
- CLI: ships as one built file inside the app; launchers installed by earlier versions keep working. (#522)

### 🐛 Fixed

- Canvas: a node created in a Space that has no free room is placed to the right of, then below, its members, and the Space and its parent Spaces grow to contain it, instead of landing outside them; `opencove space get` and `space list` return the Space's position and size (`rect`), and question summaries include option descriptions. (#591)
- CLI: option values may start with `-` (`--text "-v is verbose"`); a Worker that lacks a command now exits 5 and says to restart or update OpenCove; `fs write` prints the written path and size; every node created or updated with `--frame` reports the applied frame and says when it was adjusted; `context` includes your own node (`self.node`); and `agent read --turn` on an unfinished turn says when the agent is waiting for the user. (#586)
- Agent terminals can no longer use the OpenCove API to make the user's decisions: they cannot type into another session (and so answer its permission dialog), read or change settings, launch agents with broader permissions than the user configured, send prompts that start a provider's shell or slash commands, or run plugin code. `opencove api ops` and `api schema` show what an agent terminal may call and why not, and the session token is only sent to its own endpoint. Project isolation is not yet enforced. (#583)
- Persistence: repeated Agent title queries no longer flood the Worker with transcript scans and cause workspace saves to fail with “Unable to save data to storage.” (#580)
- Agents: restoring sessions no longer replays past completions or repeatedly shows completion alerts. Codex startup only binds its session identity, and each observed turn completion notifies once. (#580)
- Agent: closing or deleting an agent window, or quitting OpenCove, now also stops the commands and servers the agent started; they used to keep running in the background after Codex or Claude Code exited. Plain terminals are unchanged, so `nohup` still works there. (#576)
- Agent windows: after a workspace switch, reload, reopen, restart or font change, an agent window keeps the terminal state Claude Code set up (alternate screen, bracketed paste, mouse tracking), so multi-line pastes stay one message and the mouse wheel keeps working; a spinner redraw during restore no longer resets the terminal. (#579)
- Agent: Codex windows get OpenCove's lifecycle hooks even when the shared Codex app-server daemon is running, so their working/idle state is reliable and `opencove agent prompt` can reach them; they used to skip hooks to reuse the daemon. Settings → Agent → Codex → Reuse a running Codex app-server restores the old behavior. (#574)
- Website windows: a frozen website window now always gets its snapshot; a snapshot requested before the page's first frame was presented used to be dropped. (#474)
- Agent: give each managed Claude launch its own conversation ID and preserve it across recovery, preventing same-directory nodes from binding to the newest unrelated transcript. (#425)
- Terminal: probe WebGL support once and release the probe, so workspaces with many terminals no longer evict active terminal renderers. (#428)
- Canvas: keep zooming smooth in large workspaces by no longer restyling every window on each zoom step. (#429)
- Terminal: when a terminal is restored or redrawn, questions programs asked the terminal earlier (such as its background colour) are no longer answered again into the shell, which could show errors like "command not found: 11". (#455)
- Sync: changes made through the CLI, agents, plugins or the Web UI are no longer reverted by the desktop window a moment later. (#530)
- Worker: only one Worker can own a profile at a time, so Desktop can no longer start a second Worker that writes the same database. (#523)
- Agents: when OpenCove is started from inside a Claude Code session, its terminals and agents no longer inherit that session's markers and messaging credentials, which had turned off transcript saving for canvas Claude Code agents. (#547)
- Agents: Claude Code transcripts are found under `CLAUDE_CONFIG_DIR` when it is set, so session observation, resume and final messages work with a custom Claude config directory. (#548)
- Agents: a message typed while Claude Code is working stays in the current turn, so the agent no longer shows as idle and ready while Claude answers it in a follow-up, and `agent read --turn` returns the answer that includes it. (#562)
- Agents: a Codex agent no longer shows as idle while it works on a prompt sent right after its previous turn. (#559)
- Agents: an agent started inside a canvas terminal keeps `opencove` on its PATH even when the shell's startup files replace PATH, and `agent get` and `agent read` work on terminal nodes. (#560)

## [0.4.0] - 2026-10-12

OpenCove 0.4.0 introduces the Pixel workspace, desktop-style collapsed windows, and independently installable plugins and themes. It also improves file navigation, terminal links and Agent recovery.

### ✨ Highlights

- **Pixel workspace**: Cohesive dark and light themes, shared window styling, and configurable pixel effects for the canvas and Agent activity.
- **Desktop-style canvas**: Collapse live windows into persistent icons, organize them within Spaces, and create windows by clicking or dragging from the toolbar.
- **Plugins and themes**: Install local or Git packages, preview and manage them in Settings, and create extensions with the bundled documentation and CLI guide.
- **Files and navigation**: Browse folders in icon or tree views, drag files onto the canvas, and keep important Spaces and Agents in view with the redesigned Sidebar.

### 🚀 Added

- Appearance: add Pixel and Pixel Light themes, shared window chrome, provider icons, color accents and configurable canvas, window and Agent activity pixel effects. (#422)
- Canvas: collapse windows into persistent desktop icons, restore them with smooth motion and configurable placement, arrange compact windows within Spaces, and create nodes by clicking or dragging from the canvas toolbar. (#422)
- Files: add directory nodes with icon and tree views, breadcrumb navigation and path copying, plus file and folder drops onto the canvas. (#422)
- Sidebar: add a compact project rail, project hover navigation, pin and hidden visibility modes, direct unpin actions and project-switching shortcuts. (#422)
- Settings: use a main-area settings page with themed live previews, compact Agent ordering, simplified connection controls and plugin documentation. (#422)
- Plugins: install independent local or Git packages with standard canvas windows, commands, packaged Skills, preferences, Sidebar trees, themes and explicit project-scoped host operations. (#422)
- Themes: inherit built-in foundations and customize component skins, bundled images and fonts, typography, window metrics and lifecycle-managed effects; keep Desktop, Web UI and live plugin content synchronized while preserving user preferences. (#422)
- Plugins: manage details and interactive previews, entry-point visibility, enablement, reload and removal; inspect Git updates, preserve local edits, resolve update candidates, roll back code and discover repositories on GitHub. (#422)

### 🐛 Fixed

- Canvas: use compact geometry for Space resizing and collision handling, preserve collapsed windows across restarts, and keep window content mounted through collapse and expansion. (#422)
- Canvas: preserve local collapse changes when an older Worker snapshot arrives, and retry persistence after an unsuccessful legacy-state migration. (#422)
- Canvas: start new-window pixel effects on the next animation frame without waiting for the background refresh interval, while preserving the reveal duration. (#422)
- Themes: restore window color accents and material gradients, and keep terminal viewport styles within the shared theme layer. (#422)
- Plugins: keep documentation images, links and keyboard focus stable when the detail page updates. (#422)
- Files: preserve original mount bindings through navigation and layout changes, and restore existing collapsed documents when following terminal file links. (#422)
- Plugins: reject stale or ambiguous targets, preserve concurrent workspace changes during asynchronous node creation, and report filesystem failures through structured errors. (#422)
- Terminal: keep link actions focused on the terminal without accidentally selecting the canvas node. (#422)
- Files: replace unsupported-file warnings with a centered file icon, readable filename, format-aware explanation, and clear default-app action across themes. (#416)
- Files: preview terminal-linked images in their original file windows, retain audio/video playback, and offer explicit system opening for unsupported formats instead of treating binary files as text. (#416)
- Terminal: recognize complete wrapped URLs and file paths, preserve file line and column navigation, and use compact link actions with predictable selection and focus. (#416)
- Terminal: open verified local directory links in the system file manager without requiring a matching Space, while preserving remote source and path permissions. (#416)
- Agent: restore Pi session listing and switching, copy the last assistant reply from the saved branch, and target the correct managed session after recovery. (#414)
- Terminal: keep launch assets in the private application profile and repair missing or damaged scripts before starting new terminals, without disrupting existing shell paths. (#415)
- Terminal: preserve Unicode profile and runtime paths in Windows Agent command shims without changing the user's code page. (#415)

---

## [0.3.3] - 2026-09-12

OpenCove 0.3.3 improves the canvas workflow, keyboard control, terminal integrations, and release tooling.

### ✨ Highlights
- Unified native image paste mappings across Pi, Kimi, Codex, Claude Code, and OpenCode terminals.
- Safer Cmd/Ctrl+W window closing and deliberate double-press Cmd+Q application quitting.

### 🚀 Added
- Canvas: choose between Zoom Flight and Smooth Slide for viewport navigation across windows and Spaces, with a saved preference and support for system reduced motion. (#400)
- Terminal: support quick command execution after session attachment. (#408)

### 💅 Changed
- Sidebar: persist Project and Space disclosure state independently across restarts. (#411)

### 🐞 Fixed
- Terminal: route desktop image paste through provider-specific native key mappings while preserving text paste. (#409)
- Desktop: close the focused input node or selected canvas node with Cmd/Ctrl+W without closing the app. (#410)
- Desktop: require two non-repeat Cmd+Q presses within 1.5 seconds before quitting on macOS. (#410)
- Workspace: keep Space archive and other operation overlays local to their target Space, preventing unrelated Space backgrounds from tinting window nodes. (#401)
- Canvas: center windows created by double-click or the context menu within 120 pixels of the viewport center, avoiding small unnecessary pans while preserving Space ownership and pointer placement farther away. (#399)
- Agent: launch remote Project agents in the default remote mount instead of the local project metadata directory, while preserving explicit Space and worktree directories. (#398)

---

## [0.3.2] - 2026-09-06

OpenCove 0.3.2 adds native Pi activity tracking, improves Windows Agent startup and recovery, and keeps managed SSH runtimes aligned with Desktop updates.

### 🚀 Added
- Agent: monitor native Pi activity in ordinary terminals and managed Agent nodes, with launch-scoped hooks, stale-event protection, and verified conversation tracking across reload, new sessions, resume, and fork. (#389)

### 🐛 Fixed

- Installation: canonicalize both runtime publisher entrypoint paths so Windows short temporary paths and long paths dispatch the same installer operation. (#396)
- Installation: resolve macOS directory aliases before publishing standalone runtimes, preventing installers from generating launchers with an empty runtime path. (#395)
- Installation: let Windows standalone runtime verification exit after native checks and output flush, preventing installer timeouts caused by retained PTY threads. (#394)
- Remote: match managed SSH Workers to the Desktop build, safely upgrade idle runtimes with profile backups, and report active-session waits, credential mismatches, and recovery failures clearly. (#392)
- Development: restore Windows dev-server startup and build identity hot reload by keeping source directory watches out of Vite's module imports. (#392)
- Agent: speed up Windows Codex startup by observing session files without injecting hooks, while preserving ordinary-terminal Agent detection and verified conversation recovery. (#391)
- Terminal: resume Agents in fresh Windows PowerShell sessions without a control character being interpreted as part of the command. (#391)
- Agent: restore Claude status updates on Windows when PowerShell adds a UTF-8 BOM to hook events. (#391)


---

## [0.3.1] - 2026-09-05

OpenCove 0.3.1 improves Agent startup and completion notifications, terminal recovery and display stability, and managed SSH connection feedback.

### 🐛 Fixed

- Agent: show completion cards and system notifications for Agents launched inside ordinary terminals, using the same notification flow as dedicated Agent windows. (#388)
- Agent: preserve an existing local Codex app-server session by skipping OpenCove's `--config` hook override when its control socket is reachable, avoiding a conflicting embedded app-server. (#384)
- Agent: avoid a misleading Fallback badge before the first Hook observation on menu launch, while retaining warnings for explicit failures and expired working signals. (#385)
- Agent: prevent Codex and Claude hooks from launching desktop instances, timing out repeatedly, and disrupting input; keep status relays headless with bounded execution. (#385)
- Terminal: allow new terminals and Agents while existing sessions recover after startup, so slow recovery no longer causes creation failures, including on Windows. (#387)
- Terminal: keep verified display calibration stable during Windows startup, window resizing, and same-kind terminal changes; show current calibration blockers consistently in Settings and diagnostics. (#386)
- Terminal: fit new windows on first mount and confirm actual Windows Console dimensions before committing a resize, with a retry action when confirmation fails. Window fitting works independently of font calibration. (#382)
- Terminal: preserve shared WebGL glyph caches when creating or refreshing terminals, preventing fragmented text in existing windows. (#382)
- Terminal: restore ready sessions independently and retain durable bindings while recovery is pending, preventing one slow recovery from leaving other terminals unresponsive. (#382)
- Terminal: prevent stale sync snapshots from replacing newly recovered sessions, and keep sizing warnings above terminal content. (#382)
- Terminal: keep resize acknowledgements distinct across renderer reloads, preventing pending requests from colliding after refresh. (#382)
- Workspace: preserve local task-Agent links and project edits while shared-state reads are pending, and retain unsaved changes when persistence fails. (#382)
- Worker: keep draining output after startup and preserve live owned processes through health-check timeouts, preventing diagnostic output or temporary load from interrupting terminal sessions. (#382)
- Agent: wait for Electron preparation and cleanup helpers in Windows PowerShell shims so commands such as `codex` reliably start in interactive terminals. (#382)
- Settings: distinguish disabled calibration, invalid adjustments, and valid saved adjustments waiting for a matching display environment, in English and Chinese. (#382)
- Agent: show idle Claude terminal sessions as Standby, remove all Agent chrome after Claude Code or Codex exits while preserving conversation recovery data, and prevent stale Working status after dedicated Agent exits. (#383)
- Remote: keep managed SSH installation and connection progress visible across Settings and folder-picker reopen, instead of reporting cold setup as a Worker or tunnel failure; automatically enable browsing when ready. (#381)

---

## Earlier releases

Releases 0.3.0 and earlier are in [docs/changelog/0.3-and-earlier.md](docs/changelog/0.3-and-earlier.md).
