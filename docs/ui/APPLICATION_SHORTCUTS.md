# Application Close and Quit Shortcuts

Desktop application shortcuts are reserved at the Electron input boundary, including
native website views. They are independent of configurable canvas commands and the
terminal-focused canvas-shortcut preference.

## Behavior

| Platform | Close selected window node | Guarded keyboard quit |
| --- | --- | --- |
| macOS | Cmd+W | Press Cmd+Q twice within 1.5 seconds |
| Windows | Ctrl+W | No new mapping; preserve existing exit commands |
| Linux | Ctrl+W | No new mapping; preserve existing exit commands |

Close never closes the host BrowserWindow or quits the application, including an empty
canvas, no selected node, a disabled canvas, or an unavailable renderer. A single
selected node is the target. With multiple selected nodes, only the focused selected
node is closed. If focus does not identify a selected node, an application message asks
the user to select the window to close. Selection array order does not imply focus.
Bulk deletion remains a separate command with its existing confirmation semantics.
Document nodes use their existing save-before-close and conflict handling.

On macOS the first Cmd+Q displays a localized warning. Autorepeat never confirms quitting.
The second non-repeat keydown within 1.5 seconds confirms quitting. Electron's macOS
Command input stream can omit keyup, so confirmation cannot depend on release. Timeout,
another non-modifier key, host blur, navigation, renderer loss and disposal cancel the
attempt. Explicit menu Quit, window controls, OS shutdown and application updates keep
their existing lifecycle behavior. Windows/Linux Ctrl+Q remains available to terminal
XON and other existing consumers.

## Ownership and Invariants

| State | Owner | Write entry | Restart source |
| --- | --- | --- | --- |
| Quit confirmation | Main window input policy | Keyboard input and lifecycle cancellation | None; transient |
| Selected nodes and focused target | Workspace Renderer | Existing selection and DOM focus | Existing workspace/view state |
| Close in flight | Workspace Renderer shortcut subscription | Existing node close operation | None; transient |
| Warning | App shell Renderer | Validated Main event | None; derived UI |
| Durable flush and Worker shutdown | Existing Main quit coordinator | Confirmed `app.quit()` | Existing persisted state |

1. A close shortcut cannot become host-window close or application quit.
2. Unconfirmed keyboard quit cannot begin persistence/Worker shutdown; confirmation
   enters the existing quit coordinator exactly once.
3. Node closure uses the selected target and existing node/document owners. No selection
   snapshot, quit confirmation or additional durable truth is mirrored into Main.

Main consumes `before-input-event` before page events and native menu accelerators,
then sends a fixed semantic event through Preload. Preload validates the event union,
exposes only subscription/unsubscription and never exposes a renderer-callable quit API.
Each host owns its policy and cancels its timer/listeners on disposal. Async node-close
requests suppress duplicates and only publish failures while their subscription is live.
No schema, migration, recovery policy or executable architecture rule changes are required.

## Rationale and Regression

The policy adapts Chromium's deliberate quit confirmation to Electron's input stream.
It uses two non-repeat keydowns instead of a native nested event loop or a hold timer.
Chrome's Windows shortcut differs from macOS; Ctrl+Q is intentionally not generalized.

- [Chrome shortcuts](https://support.google.com/chrome/answer/157179)
- [Chromium quit confirmation implementation](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/cocoa/confirm_quit_panel_controller.mm)
- [Electron before-input-event](https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event)

Regression coverage: `applicationShortcutPolicy.spec.ts`, `applicationShortcuts.spec.ts`,
`closeSelectedNodeShortcut.spec.tsx`, and `application-shortcuts.mac/windows.spec.ts`.
The platform E2E files run on their corresponding CI runners. Policy tests exercise
macOS, Windows and Linux modifier semantics on every host.
