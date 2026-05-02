# Website Window Node

Website Window Node lets a canvas node host a real web page runtime while keeping durable canvas state separate from Electron `webContents` state.

## Current Capabilities

- Create from canvas/pane menu.
- Create from pasted URL when website window paste is enabled.
- Navigate, go back, go forward and reload.
- Persist node URL, pinned flag, session mode, profile id and frame.
- Support session modes: `shared`, `incognito`, `profile`.
- Manage runtime lifecycle states: `active`, `warm`, `cold`.
- Capture an in-memory snapshot for cold placeholder.
- Enforce an active window budget and warm/cold discard policy.
- Keep selected hosts alive via `keepAliveHosts`.

## Runtime Owner

Main owns real website runtime through `WebsiteWindowManager`:

- creates and disposes `WebContentsView`
- applies bounds and viewport metrics
- handles lifecycle transitions
- emits state/snapshot/error/open-url events
- enforces active budget

Renderer owns:

- node chrome and canvas placement
- user intent controls
- durable node data edits
- placeholder display

Renderer never owns `webContents` or Electron view lifecycle.

## IPC Surface

Channels are defined in `src/shared/contracts/ipc/channels.ts` and DTOs in `src/shared/contracts/dto/websiteWindow.ts`.

Current operations:

- `websiteWindow.configurePolicy`
- `websiteWindow.setOccluded`
- `websiteWindow.activate`
- `websiteWindow.deactivate`
- `websiteWindow.setBounds`
- `websiteWindow.navigate`
- `websiteWindow.goBack`
- `websiteWindow.goForward`
- `websiteWindow.reload`
- `websiteWindow.close`
- `websiteWindow.setPinned`
- `websiteWindow.setSession`
- `websiteWindow.captureSnapshot`

Events:

- `state`
- `snapshot`
- `closed`
- `error`
- `open-url`

## Durable State

Persisted node data:

- `url`
- `pinned`
- `sessionMode`
- `profileId`
- node frame and canvas metadata

Not persisted:

- `webContents`
- DOM / JS heap
- current scroll position or form state
- in-memory snapshot image
- runtime lifecycle object

## Lifecycle

`active`:

- The node has a live `WebContentsView`.
- Bounds and viewport metrics are applied from canvas state.

`warm`:

- Runtime remains available but is not the active visible view.
- Used when active budget is exceeded or node is deactivated.

`cold`:

- Runtime view is disposed to release resources.
- Node can display a snapshot or placeholder.
- Reactivation recreates runtime and loads desired URL.

Pinned nodes and `keepAliveHosts` influence discard behavior but do not make browser runtime state durable.

## Security

- Website runtime is hosted by Main-managed Electron views.
- Renderer communicates through validated IPC.
- Electron security baseline remains `contextIsolation: true`, `nodeIntegration: false`, and sandboxed web content where applicable.

## Verification Anchors

- `tests/e2e/workspace-canvas.website-window.spec.ts`
- `tests/e2e/workspace-canvas.website-window.freeze.spec.ts`
- `tests/e2e/workspace-canvas.website-window.device-pixel-ratio.spec.ts`
- `src/app/main/websiteWindow/WebsiteWindowManager.ts`
