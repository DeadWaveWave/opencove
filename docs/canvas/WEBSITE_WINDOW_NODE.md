# Website Window Node

Website Window Node lets a canvas node host a browser runtime while keeping durable canvas state separate from Electron `webContents` state. The complete browser capability plan and current implementation status live in `docs/canvas/BROWSER_WINDOW_CAPABILITY_SPEC.md`.

## Current Capabilities

- Create from canvas/pane menu.
- Create from pasted URL when website window paste is enabled.
- Navigate, go back, go forward, reload, stop and open the local start page.
- Support Safari-style start page search, local history, bookmarks, downloads, permission prompts and page find in client-native mode.
- Support `native` and `iframe` browser modes through Settings. The node toolbar no longer owns mode switching.
- Default browser nodes use the same footprint as four canonical terminal windows, then clamp normal windows to `90%` of the available canvas viewport.
- Support configurable default search engines for address-bar and start-page search text.
- Persist node URL, pinned flag, session mode, profile id, browser mode, fullscreen state, previous frame and current frame.
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
- start page and placeholder display

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
- `websiteWindow.stop`
- `websiteWindow.findInPage`
- `websiteWindow.stopFindInPage`
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
- `find-result`
- `download`
- `permission-request`

Browser profile operations are exposed separately through `browserProfile.*` preload APIs. Those APIs own history, bookmarks, downloads and permission decisions as client-local data. Website nodes now treat Home as a local start page projection rather than a remote homepage URL.

## Durable State

Persisted node data:

- `url`
- `pinned`
- `sessionMode`
- `profileId`
- `browserMode` for sync/WebUI fallback semantics. Desktop clients use Settings as the runtime mode owner.
- `isFullscreen`
- `previousFrame`
- node frame and canvas metadata

Not persisted:

- `webContents`
- browser cookies/cache, history, bookmarks, downloads and permission decisions in shared workspace state
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
- Full native browser capability exists only in the desktop/client runtime.
- WebUI-created browser nodes default to iframe mode.
- WebUI renders synced native nodes as a client-only placeholder and only switches to iframe after explicit user action.
- iframe mode uses an explicit app `frame-src` CSP allowance and the strongest compatible sandbox found for the fallback path, including `allow-same-origin` and user-activated top navigation. It also rewrites Google search/home iframe sources to `igu=1` where applicable, but cannot bypass remote `X-Frame-Options`, CSP `frame-ancestors`, login, cookie or browser embedding policy.

## Verification Anchors

- `tests/e2e/workspace-canvas.website-window.spec.ts`
- `tests/e2e/workspace-canvas.website-window.freeze.spec.ts`
- `tests/e2e/workspace-canvas.website-window.device-pixel-ratio.spec.ts`
- `tests/e2e/workspace-canvas.website-window.iframe.spec.ts`
- `src/app/main/websiteWindow/WebsiteWindowManager.ts`
