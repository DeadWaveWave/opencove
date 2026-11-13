# Changelog

All notable changes to **OpenCove** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Agents: `opencove node create agent --full-access true|false` (also `node.create` `data.agentFullAccess` and plugin `agents.launch`) sets Full Access for that one agent, even when another agent starts it, without changing Settings; relaunch, resume and recovery keep the choice. (#462, #612)
- Agents: `opencove node create agent --task <id>` (also `node.create` `data.taskNodeId` and plugin `agents.launch`) links the new agent to a task in the same Space and moves the task to doing, as Run from the task does. (#463)

### Fixed

- Documents: typing fast in a document window, for example right after a terminal file link opens it, no longer drops characters or moves the caret. (#621)
- Agents: after a restart, `opencove agent` and `opencove events` find a restored Claude Code agent right away, instead of only after the next change on the canvas.

## [0.5.0] - 2026-11-12

OpenCove 0.5.0 redraws the app in pixels around one generated theme, shows on the canvas what every Agent is doing, tells you once when an Agent needs you, and lets Agents hand work to each other through a rebuilt `opencove` CLI. The Worker now owns what is saved and which conversation each Claude window resumes.

### ✨ Highlights

- **Cove, drawn in pixels**: one theme generated with checked contrast in light and dark, pixel icons across the app, glass windows on solid reading plates, and a pixel wall drawn on the GPU behind the canvas.
- **A canvas that shows the work**: windows light the wall in their kind colour, working Agents patrol their frame, finished runs flash and send a shockwave, waiting Agents pulse and point from the canvas edge, and far view turns every window into a readable tile.
- **Agents that need you, once**: the top-bar Agent pill lists every Agent, a card grows out of it when one waits for you, and one router decides the card, the system notification and a pixel sound.
- **Agents that work together**: Agents and terminals on the canvas know where they are, and `opencove` lets them start Agents, hand them a prompt, wait for that turn and read its reply, within limits you keep.
- **Saved means saved**: every window and browser tab converges on what the Worker stored, and each Claude window resumes the conversation it was in, also after `/clear`.

### 🚀 Added

- Agents: agents and terminals started on the canvas know which node, Space and project they belong to and get `opencove` on their PATH with a session-lifetime token for permitted API operations; `opencove whoami`, `opencove context` and `@self`, `@parent`, name and ID-prefix selectors let an agent orient itself, and `spawnedBy` / `lineageDepth` show which agent started each node. (#528, #540, #597)
- Agents: hand work to another agent. `opencove agent prompt` pastes a prompt into a Claude Code or Codex window OpenCove launched, confirms that it arrived and never sends it twice; a prompt to a working agent steers its current turn, and nothing is sent while it waits on a dialog. `agent wait --turn` and `agent read --turn` follow that exact turn, also after a restart (the last 60 turns per agent are kept for 30 days; `opencove agent history clear` deletes them). `agent prompt --wait --read` does all of it in one command, and `node create agent --prompt … --wait --read` starts an agent and returns its first reply. (#544, #549, #550, #553, #554, #556, #563, #566, #570, #572, #589, #594, #598)
- CLI: `opencove` is rebuilt for AI agents and scripts: grouped help with examples, compact JSON with `--fields`, optional table output, `--limit`, `--<option>-file <path|->` for long values, actionable errors with suggestions, stable exit codes, and `opencove api ops|schema|call` for every Control Surface operation. `opencove skill` prints a usage guide matching the CLI version, with topics for the canvas, coordinating, waiting, reading and access. (#521, #524, #525, #529, #532, #538, #551, #590)
- CLI: arrange the canvas from a terminal: `node create <kind> --root-canvas` and `node list --root-canvas` work outside Spaces; `space create` (with `--in` and `--move`) and `space update` create, rename and resize Spaces without moving their members; `project add` adds a project; `node update agent|terminal --title` renames windows; and `agent stop` stops an agent without deleting its window. (#581, #584, #588, #595)
- Control Surface: create projects and Spaces, address agent and terminal sessions by canvas node, and read and subscribe to each agent's run state and completed turns, so a headless Worker can be set up and driven from the CLI. (#526, #527, #533)
- Agents: Claude Code and Codex agents that OpenCove launches learn at session start that they run in OpenCove, with a short guide to posting notes, marking tasks `ai_done` and asking before starting other agents. Turn it off in Settings → Agent → Tell agents about OpenCove. (#585)
- Notifications: when an Agent waits for you, OpenCove tells you once. A card grows out of the top-bar Agent pill, a system notification appears only while OpenCove is in the background, and a pixel sound plays; each channel has its own switch, and Agents that start waiting together share one alert. (#568, #571)
- Top bar and sidebar: the Agent pill lists every Agent across projects, waiting ones first, and a "Needs you" inbox at the top of the sidebar jumps to each. The pill, inbox, project tile badge, Agent row and Space card all count the same Agents. (#458, #460, #571, #573)
- Canvas: choose the background in Settings → Appearance: Pixel, a pixel wall with soft colour clouds and a sparse twinkle that stays calm behind windows and keeps its colours across zoom; Minimal, a quiet dot grid; or Off. The wall draws on the GPU and falls back to Canvas 2D without hardware graphics. (#485, #486, #489, #491, #492, #498, #507, #535)
- Canvas: windows show what they are doing on the wall. Each lights the cells around it in its kind colour, terminal output ripples outward, a working agent sends a sonar wave while two trains of pixels patrol its frame, a finished run flashes and sends a shockwave with sparks, a failure glitches red, and windows assemble and shatter in their kind colour. Reduced motion keeps still equivalents. (#490, #493, #496, #497, #534, #539, #541, #543)
- Canvas: an Agent waiting for you pulses on the wall and wears an amber halo; when it is out of view, a beacon at the canvas edge names it and flies there on click. (#494, #543)
- Canvas: below 25% zoom every window becomes a tile in its kind colour with its icon, title and status at one size on screen, while terminals and pages keep running; click a tile to fly there, drag it to move the window, or right-click it for the window menu. A zoom HUD and a Far / Near switch sit on the canvas, and Settings → Appearance → Far View turns far view off. (#481, #500, #509, #518, #552)
- Tasks: the task window is a pixel task card with a four-step progress control, a priority flag and tags, the requirement, a row of session avatars and a Run button. (#561)
- Command Center: ⌘P finds windows (with their Space) as well as Spaces, projects and commands, lists Agents waiting for you first, and enters Showcase mode, which hides the interface for recordings until you press Esc. (#475, #504)
- Settings: search finds every row on every page. (#470)
- Plugin themes: a theme can declare four inputs (light or dark, a base tint, an accent colour and contrast), and OpenCove generates the whole palette with the same checked contrast as Cove. (#477)

### 💅 Changed

- Appearance: Cove, whose colours are generated with checked contrast, replaces Standard and is the default, with Cove Dark for new installs. Ember, Pixel and Pixel Light retire into Cove: existing choices and plugin themes that extend them move to Cove dark or light. (#439, #564)
- Appearance: every icon is a pixel icon on one 12-cell grid, and Agent icons show their provider's mark in the AI kind colour. (#510, #519, #558)
- Windows: every window shares one header: a tile in its kind colour (agents purple, terminals green, tasks orange, notes and documents blue, websites and images pink), the title, status, and the same collapse and close buttons; the whole title bar drags the window. Content sits on a solid reading plate, faintly tinted by kind, that melts into the glass frame. Settings → Appearance → Window Kind Colours turns kind colours off, and plugin windows can choose a kind with `view.kind`. (#450, #451, #453, #478, #520, #546, #552, #561)
- Windows: choose Window Material (Glass or Solid) in Settings → Appearance. Solid makes windows, menus and panels opaque, and windows turn solid whenever the system reduces transparency. (#449, #480)
- Terminals: Settings → Terminal → Terminal Background chooses Auto (transparent on macOS, opaque on Windows and Linux), Transparent or Opaque, and changing it keeps the running shell. (#456)
- Website windows: the page title sits in the header, and back, forward, reload and the address bar move to the toolbar below it. (#452)
- Agent windows: status pills use larger text and keep colour for what needs attention: working uses the accent, waiting is yellow and failed is red. (#443)
- Shell: the top bar and sidebar float on the pixel wall as glass, and the settings page is a frosted sheet over it. A top-bar button hides the sidebar completely and moves into the traffic lights' place in macOS full screen. The command entry names the current project and Space. (#458, #501, #503, #511, #555)
- Sidebar: projects are colour tiles on the rail with a waiting count and working dots; Focus, Normal and All are one segmented control; the project name shows its branch; and each Space is a card with a live pixel map of its windows, its worktree branch and its working and waiting counts. (#459, #466, #484, #502, #512, #546)
- Control Center: a pixel window with the appearance (light, dark or follow system) and switches for the minimap, in-app notifications, system notifications and sound. (#457, #564)
- Controls: themed tooltips that also open on keyboard focus, shared switches, checkboxes, chips, segmented controls and labelled text fields, settings rows whose labels name their control, and right-click menus that show shortcuts. (#442, #444, #445, #446, #448, #471, #483)
- Settings: new installs start with Agent Full Access off, so agents stay in their sandbox and ask before running commands or changing files; existing choices are kept. (#461)
- Canvas: decorative effects run at an even 30 frames a second while OpenCove is focused and slow to 10 in the background. (#485)
- Agents: agents in OpenCove terminals can run at most 6 agents or terminals per tree of agents they started, no deeper than a grandchild of an agent you started, and the refusal says how to free a slot. Agents and terminals you start yourself, task runs and restarts are never limited. (#600)
- Agents: OpenCove says why an agent is waiting (an approval, a question with its options, or a plan to review) in the CLI, sidebar, Agent pill, collapsed windows and edge beacons; `opencove agent wait` stops with exit 10 when an agent waits for the user and 11 when it exits. (#582, #587)
- Claude agents: the Worker owns which conversation each Claude window resumes, and every launch, relaunch and restart goes through one owner, so a stale window or a late save can no longer roll it back and restarting after `/clear` resumes the new conversation. Existing windows are adopted on their next cold start; `OPENCOVE_MANAGED_CLAUDE_BINDINGS=0` pauses adoption in an emergency without dropping protection. (#596, #599, #603, #604)
- Sync and persistence: every window and browser tab converges on what the Worker actually saved and catches up after reconnecting or a Worker restart. Changes made by the CLI, agents, plugins, the Web UI or the Worker reach every window and are no longer reverted; quitting waits briefly for your last edits; importing a workspace can no longer be undone by a pending autosave. Older Workers keep working, and features that need a newer one say so. (#530, #601, #602)
- CLI: errors say whether retrying can help and list ambiguity candidates; long lists show 50 rows with `truncated` / `total`; create commands accept `-q`; and the CLI ships as one built file inside the app, while launchers from earlier versions keep working. (#522, #592)

### 🐛 Fixed

- Agents: agent terminals can no longer use the OpenCove API to make the user's decisions: they cannot type into another session, change settings, launch agents with broader permissions than you configured, start shell or slash commands through prompts, or run plugin code. `opencove api ops` shows what an agent terminal may call. Project isolation is not yet enforced. (#583)
- Agents: with Full Access off, Claude Code agents start in Claude's ask-first mode, even when your own Claude default is auto mode or skips permissions. (#609)
- Agents: closing or deleting an agent window, or quitting OpenCove, also stops the commands and servers the agent started. Plain terminals are unchanged, so `nohup` still works there. (#576)
- Agent windows: after a workspace switch, reload, restart or font change, an agent window keeps the terminal state Claude Code set up (alternate screen, bracketed paste, mouse tracking), so multi-line pastes stay one message and the mouse wheel keeps working. (#579)
- Agents: Codex windows get OpenCove's lifecycle hooks even while the shared Codex app-server daemon runs, so their working and idle state is reliable; Settings → Agent → Codex → Reuse a running Codex app-server restores the old behaviour. (#574)
- Agents: each managed Claude launch gets its own conversation ID, so windows in the same directory no longer bind to the newest unrelated transcript. (#425)
- Agents: restoring sessions no longer replays past completions or repeats completion alerts, and repeated Agent title queries no longer flood the Worker and fail saves with "Unable to save data to storage." (#580)
- Agents: a message typed while Claude Code works stays in the current turn, and a Codex agent no longer shows as idle while it works on a prompt sent right after its previous turn. (#559, #562)
- Agents: when OpenCove is started from inside a Claude Code session, its agents no longer inherit that session's markers; Claude Code transcripts are found under `CLAUDE_CONFIG_DIR`; and agents keep `opencove` on PATH even when shell startup files replace it. (#547, #548, #560)
- Canvas: a node created in a full Space is placed beside its members and the Space grows to contain it, instead of landing outside. (#591)
- Canvas: dragging a window no longer re-renders every other window (about 60 → 120 fps with 100 windows), zooming stays smooth in large workspaces, and Worker refreshes no longer re-render unchanged tasks. (#429, #508, #536)
- Terminal: WebGL support is probed once, so workspaces with many terminals no longer evict active renderers, and a restored terminal no longer answers old terminal queries into the shell (such as "command not found: 11"). (#428, #455)
- Worker: only one Worker can own a profile at a time, so Desktop can no longer start a second Worker that writes the same database. (#523)
- Installation: installing the standalone server or a managed SSH runtime on Windows no longer fails with `EPERM` when antivirus briefly holds the freshly extracted files; OpenCove retries the move for up to 60 seconds. (#608)
- CLI: control tokens never start with `-`, so `--token <token>` always parses, and option values may start with `-`; a Worker that lacks a command exits 5 and says to update OpenCove. (#578, #586)
- Website windows: a frozen website window always gets its snapshot. (#474)

---

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
