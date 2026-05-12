# Browser Window Capability Spec

本规格定义画布内 Browser Window Node 的目标能力边界。它基于现有 Website Window Node 演进：继续保持画布节点、浏览器运行时和持久化浏览器数据的 owner 清晰分离，同时把客户端内置浏览器提升到接近系统浏览器的完整体验。

Status: Implemented and verified for the full browser capability slice, including Settings-owned runtime mode, Safari-style local start page and configurable default search engine. The remaining exclusions are browser plugins/extensions, password/autofill sync, full DevTools productization, and unsandboxed local file browsing.

## Implementation Status

- Done: SQLite schema version `9` with browser profile settings, history, bookmarks, downloads and permission decision tables.
- Done: client-local `BrowserProfileStore` and IPC/preload surface for local start-page projection, history, bookmarks, downloads and permission responses.
- Done: Website node data normalization for `browserMode`, `isFullscreen` and `previousFrame`.
- Done: default browser window size is the same footprint as four canonical terminal windows, with normal-window clamp at `90%` of the available canvas viewport plus explicit canvas fullscreen and restore.
- Done: native runtime support for navigation history fallback, stop, find-in-page, favicon state, download events and permission request events.
- Done: Renderer browser chrome for back/forward, reload/stop, home/start page, bookmark star, bookmarks/history/download panels, Ctrl/Cmd+F find bar and fullscreen.
- Done: Settings controls for default browser mode and default search engine.
- Done: Safari-style local start page with search, bookmarks/favorites and recent history.
- Done: WebUI-created nodes default to iframe; synced native nodes render a friendly client-only placeholder and offer an explicit web-compatible viewer action.
- Done: iframe fallback uses an explicit app `frame-src` CSP allowance, a browser-compatible sandbox, iframe-friendly Google search/home URLs, and an understandable fallback state when the iframe reports a load error. Sites may still block embedding through `X-Frame-Options`, CSP `frame-ancestors`, login, cookie or browser policy.
- Done: targeted verification for profile store behavior, sizing/fullscreen helpers, old node normalization, runtime store events, session permission/download hooks, IPC registration and SQLite migrations.
- Done: final staged line check and full `pnpm pre-commit` passed again on 2026-05-12 after the four-terminal default size and iframe fallback follow-up.
- Done: follow-up targeted verification for settings normalization, Settings UI controls, address/search target resolution, app CSP `frame-src`, iframe sandbox/source behavior, real Electron iframe rendering, browser runtime store events and default browser sizing.

## Verification Status

Final implementation verification:

- `pnpm line-check:staged`: passed.
- `pnpm exec tsc -p tsconfig.node.json --noEmit --pretty false`: passed.
- `pnpm exec tsc -p tsconfig.web.json --noEmit --pretty false`: passed.
- Targeted Vitest for browser profile store, website-window store/view, website node data/frame, iframe fallback helpers, app CSP, default sizing, IPC registration and persistence migrations: passed.
- Targeted Electron E2E for iframe-mode content rendering through app CSP and native website-window layout/clip behavior: passed.
- `pnpm pre-commit`: passed, including 77 staged-related Vitest files / 211 tests and Electron E2E with 221 passed and 47 skipped.

## Problem Class

这属于成熟的嵌入式浏览器壳层问题：主流浏览器都提供导航、历史、书签、主页、下载、权限、查找、新窗口处理等稳定心智；Electron 则提供 `WebContentsView`、`webContents`、`session`、download 和 permission hooks 作为客户端实现边界。

OpenCove 当前不清晰的承诺是：画布内网页节点已经能导航和恢复 URL，但还不是完整浏览器。浏览历史、书签、主页、下载、权限、WebUI 降级行为和尺寸上限都没有统一的 durable owner 与跨运行时语义。

## External References

- [Electron `WebContentsView`](https://www.electronjs.org/docs/latest/api/web-contents-view): native embedded web surface.
- [Electron `webContents`](https://www.electronjs.org/docs/latest/api/web-contents): navigation, load state, find-in-page, window open handling and page events.
- [Electron `NavigationHistory`](https://www.electronjs.org/docs/latest/api/navigation-history): back/forward stack operations where supported.
- [Electron `session`](https://www.electronjs.org/docs/latest/api/session): partitioned browser session, cookies/cache and permission handlers.
- [Electron `DownloadItem`](https://www.electronjs.org/docs/latest/api/download-item): download metadata, progress and completion states.
- [Electron Security Tutorial](https://www.electronjs.org/docs/latest/tutorial/security): context isolation, node integration, sandbox and navigation control.
- Chrome Help for [homepage/startup](https://support.google.com/chrome/answer/95314?hl=en), [bookmarks](https://support.google.com/chrome/answer/188842?hl=en) and [history](https://support.google.com/chrome/answer/95589?hl=en) as user-facing browser commitments.

迁移原则：

- 浏览器 runtime 由 Main/client 边界拥有，Renderer 只表达用户意图。
- 主页、历史、书签、下载记录、权限决定是 durable browser profile data，不应混在临时 UI store 里。
- 不能把 iframe 和 native `WebContentsView` 当成同等能力。iframe 是 WebUI fallback，能力天然受浏览器安全策略限制。

## Product Scope

必须支持：

- 导航：地址栏、URL 规范化、Back、Forward、Reload、Stop、Home。
- 历史记录：记录访问、搜索、打开、删除单条、清空范围。
- 书签：添加、删除、重命名、搜索、打开，当前页星标状态。
- 主页：Home 按钮和空 URL 的新建浏览器节点显示本地起始页。起始页应像 Safari Start Page 一样提供搜索入口、书签/常用项和最近访问入口，而不是直接导航到某个外部 URL。
- 搜索引擎：用户可以在设置中选择默认搜索引擎。地址栏和起始页搜索框对非 URL 输入使用该搜索引擎。
- 下载：开始、进度、完成、失败、在系统中显示、取消。
- 权限：摄像头、麦克风、地理位置、通知等权限请求必须走应用内确认。
- 页面内查找：find next/previous、匹配计数、关闭查找。
- 新窗口：`target=_blank`、`window.open` 等应创建新的画布浏览器节点或 iframe fallback，而不是逃逸到不可控窗口。
- 标题和图标：显示当前页面标题、favicon、加载状态和错误状态。
- 全屏：浏览器节点支持显式全屏模式。
- 运行时切换：客户端通过 Settings 选择默认 browser mode。节点内不显示每个窗口的 native/iframe 切换控件；WebUI placeholder 的显式 iframe 降级动作仍保留。

不包含：

- 浏览器插件或扩展系统。
- 密码管理器、自动填充、跨设备同步。
- 完整开发者工具产品化体验。
- 任意本地文件浏览器能力。`file://` 是否支持必须另行安全评审，默认不纳入。

## Runtime Modes

Browser Window Node 有两个渲染模式：

- `native`: 客户端模式。由 Electron Main 管理 `WebContentsView` / `webContents` / `session`，提供完整浏览器能力。
- `iframe`: Web runtime fallback。由 Renderer 使用 `iframe` 承载 URL，提供部分浏览器能力。

Mode rules:

- 客户端通过 Settings 选择 `native` 或 `iframe` 作为默认浏览器模式。新建节点使用该偏好；客户端渲染现有节点时也尊重该偏好。
- WebUI 不能创建或运行 `native` 节点。
- 如果一个 `native` 节点由客户端创建并同步到 WebUI，WebUI 必须显示用户友好的占位提示，例如“此浏览器窗口正在桌面客户端中运行，请在对应客户端查看”。
- WebUI 用户想在 WebUI 打开浏览器窗口时，必须降级为 `iframe` 节点。
- WebUI 不得静默把客户端 `native` 节点改成 `iframe`。降级必须来自明确用户动作，例如“在 WebUI 中以 iframe 打开”。
- iframe mode 的能力限制必须在 UI 中可解释：部分网站会因为 `X-Frame-Options`、CSP、登录、第三方 Cookie 或浏览器策略而无法显示。

## Size And Fullscreen Rules

普通窗口模式：

- Browser Window Node 的屏幕占用不得超过当前可用画布视口宽高的 `90%`。
- 新建 Browser Window Node 的默认尺寸等于 `2 x 2` 个 canonical Terminal Window 的占位面积。
- 约束必须覆盖新建、恢复、手动 resize、程序化 resize、Arrange、从链接打开新窗口和 WebUI iframe 降级创建。
- `90%` 以可操作画布区域为基准，不以整个 OS 屏幕为基准。应扣除 app header、sidebar 和其它常驻 chrome。
- 如果 canonical size 或旧数据恢复尺寸超过上限，启动或 hydration 时必须 clamp。
- 如果最小尺寸和 `90%` 冲突，`90%` 优先，浏览器 chrome 进入 compact layout。

全屏模式：

- 全屏是显式用户状态，可以临时突破普通 `90%` 限制，占满可用画布视口。
- 进入全屏前必须保存 previous frame，退出全屏后恢复。
- 全屏必须保留可退出入口，包括按钮和 `Esc`。
- 全屏状态是 durable user intent，可以随 workspace restore 恢复，但必须按当前视口重新计算 bounds。
- native 全屏仍由 Main/client 应用 bounds；iframe 全屏由 Renderer layout 应用 bounds。

## Durable Data Model

Workspace node data should include:

- `url`: 当前 durable URL。
- `pinned`: 是否保持运行时。
- `sessionMode`: `shared`、`incognito` 或 `profile`。
- `profileId`: profile mode 下的 profile id。
- `browserMode`: `native` 或 `iframe`。该字段保留为同步和 WebUI 降级语义；桌面客户端的实际渲染模式优先使用 Settings 中的默认浏览器模式。
- `isFullscreen`: 是否处于画布全屏。
- `previousFrame`: 全屏前的 frame，用于退出恢复。

Browser profile data should include:

- history entries: URL、title、favicon、lastVisitedAt、visitCount、profile scope。
- bookmarks: id、URL、title、favicon、createdAt、updatedAt、folder/order。
- downloads: id、URL、filename、savePath、state、receivedBytes、totalBytes、startedAt、endedAt。
- start page data projection: profile/global bookmarks and recent history shown on the local start page。
- permission decisions: origin、permission、decision、updatedAt、profile scope。

App settings should include:

- default browser mode: `native` or `iframe` for desktop/client rendering.
- default search engine: engine id used by address/search inputs for non-URL queries.

Incognito rules:

- Incognito 不写入被动历史。
- Incognito 不持久化权限决定。
- Incognito 下载记录默认只在当前 runtime 会话内显示，是否持久化为显式用户下载记录需在 plan 阶段确认。
- Incognito 允许显式添加书签，因为这是用户主动写入 durable data。

## State Ownership

Main/client owns:

- `WebContentsView` lifecycle。
- native navigation、load state、window open handling。
- native download and permission callbacks。
- native runtime history observation。
- native bounds application。

Browser profile store owns:

- history durable truth。
- bookmarks durable truth。
- downloads metadata durable truth。
- start page source data such as bookmarks and recent history。
- permission decisions。

Workspace persistence owns:

- node frame。
- node `url`。
- node `browserMode`。
- node `isFullscreen` and `previousFrame`。
- node session mode and profile id。

Renderer owns:

- address input draft。
- local start page projection and search-box draft。
- transient menu/popover state。
- derived star/loading/error presentation。
- iframe runtime projection in WebUI or client iframe mode。

WebUI owns no native runtime state. It can only render placeholders or iframe mode.

## Browser Capability Matrix

| Capability | Client native | Client iframe | WebUI native synced node | WebUI iframe |
| --- | --- | --- | --- | --- |
| Navigate URL | Full | Partial | Placeholder only | Partial |
| Back/Forward | Full | iframe/browser-limited | Placeholder only | iframe/browser-limited |
| History | Full durable | Explicit navigation only where observable | Read-only prompt | Explicit navigation only where observable |
| Bookmarks | Full | Full UI store support | Can manage bookmarks, cannot view native runtime | Full UI store support |
| Start page/Home | Full | Full | Prompt action only | Full |
| Downloads | Full Electron download flow | Browser default or unsupported | Not available | Browser default or unsupported |
| Permissions | App-mediated | Browser-mediated or unsupported | Not available | Browser-mediated or unsupported |
| Find in page | Full | Browser-limited or custom unavailable | Not available | Browser-limited or custom unavailable |
| New window | Canvas native node | iframe node | Prompt or iframe downgrade | iframe node |
| Fullscreen | Full canvas fullscreen | Canvas fullscreen | Placeholder fullscreen not useful | Canvas fullscreen |

## Invariants

1. Renderer never directly writes passive browsing history. History is written only by the runtime owner after URL normalization.
2. A `native` node synced to WebUI is never silently converted to iframe.
3. Normal Browser Window Node bounds never exceed `90%` of the available canvas viewport.
4. Explicit fullscreen can fill the available canvas viewport, but exit restores a valid clamped previous frame.
5. `warm` and `cold` lifecycle transitions can discard runtime resources, but cannot discard durable browser data.
6. Permission requests default to deny unless the user grants them through an app-mediated decision.
7. IPC and Control Surface payloads for browser capabilities must be runtime validated.
8. iframe mode must surface capability limits instead of pretending to be a full browser.
9. Address/search input normalization is deterministic: valid `http(s)` or likely host input becomes a URL; other non-empty text becomes a search URL through the selected default search engine.
10. Page find UI appears from node-scoped `Ctrl/Cmd+F`; it is not exposed as a persistent toolbar button.

## Acceptance Criteria

Client native:

- A user can create a browser node, navigate pages, go back/forward, reload/stop, open the local start page with Home, bookmark the current page, open history, search history and restore after restart.
- A user can select the default browser mode and default search engine in Settings.
- In desktop/client rendering, switching the default browser mode in Settings affects browser nodes without requiring a per-node toolbar selector.
- Pressing `Ctrl/Cmd+F` while operating a native browser node opens the page-find bar.
- Download progress and completion are visible in-app.
- Permission requests show an app-level prompt and respect saved decisions.
- New windows become canvas browser nodes.
- Node fullscreen enters/exits reliably and restores previous frame.
- Normal node sizing never exceeds `90%` of available canvas viewport.

WebUI:

- A synced client-native node displays a clear prompt that it must be viewed in the corresponding client.
- Creating/opening a browser from WebUI uses iframe mode.
- iframe mode supports address navigation, start page, bookmark UI and best-effort back/forward where possible.
- iframe failures caused by browser embedding policies are shown as understandable in-app states.

Cross-runtime:

- Client can switch the browser runtime between native and iframe modes from Settings.
- Switching modes preserves URL, frame, bookmarks and applicable profile data.
- Incognito semantics remain separate from shared/profile sessions.

## Risk Checklist

- Async gaps: downloads, permission callbacks and navigation events can resolve after node close or app quit.
- Concurrency: rapid navigation, back/forward, fullscreen toggle and mode switching can race.
- State ownership: passive history, current URL and user-entered draft must not become competing truths.
- Restart semantics: `previousFrame`, `isFullscreen`, profile data and current URL must normalize safely across changed viewport size.
- IPC security: all browser commands require payload validation and origin/protocol checks.
- Resource lifecycle: `WebContentsView`, listeners, download callbacks and permission handlers must be disposed.
- Performance: history/bookmark search must be indexed or bounded; favicon snapshots must not block Main.
- Data integrity: SQLite schema migration must handle existing nodes without browser fields.
- Web security: iframe mode must avoid unsafe sandbox relaxations unless explicitly justified.

## Feasibility Check Required

Before implementation, verify:

- Electron 41 support and exact API shape for `NavigationHistory`, `findInPage`, favicon events, downloads and permission handlers.
- Whether page zoom and current canvas zoom handling conflict with browser-level zoom controls.
- Download behavior across macOS, Windows and Linux.
- Permission prompt behavior for camera/microphone/geolocation/notifications in sandboxed `WebContentsView`.
- iframe fallback behavior for common blocked sites and how to detect/report blocked embedding cleanly.
- Fullscreen bounds behavior with current native view clipping and occlusion logic.

## Feasibility Check Results

Checked against the repository lockfile and local Electron type definitions after `pnpm install --frozen-lockfile`:

- Locked Electron version: `41.5.1`.
- `WebContentsView` is available and already used by the existing Website Window runtime.
- `webContents.navigationHistory` exists and supports `canGoBack`, `canGoForward`, `goBack`, `goForward`, `getAllEntries`, `removeEntryAtIndex`, `clear` and `restore`.
- `webContents.findInPage`, `found-in-page` and `stopFindInPage` are available.
- `page-favicon-updated` is available for favicon URL observation.
- `webContents.stop` is available for stop-loading.
- `webContents.setWindowOpenHandler` is available and already used by the current runtime.
- `session.on('will-download')`, `DownloadItem.updated`, `DownloadItem.done`, `getReceivedBytes`, `getTotalBytes`, `getSavePath`, `setSavePath` and `cancel` are available.
- `session.setPermissionCheckHandler` and `session.setPermissionRequestHandler` are available. Electron explicitly requires both for complete permission handling.
- `session.setDownloadPath` is available for default download directory control.

Local architecture check:

- Existing native runtime owner is `WebsiteWindowManager` under `src/app/main/websiteWindow`.
- Existing Renderer UI owner is `WebsiteNode` and `useWebsiteNodeNativeView`.
- Existing durable website node data is normalized through `WebsiteNodeData` and stored in SQLite `nodes.task_json`.
- Existing SQLite schema version is `8`; browser profile tables require a schema migration.
- WebUI installs `window.opencoveApi` from `src/app/renderer/browser/browserOpenCoveApi.ts` and currently exposes no `websiteWindow` API. This is a good runtime discriminator for native placeholder vs iframe fallback.
- Existing E2E coverage for Website Window already validates native view bounds, zoom freeze, snapshots and device pixel ratio. New coverage can extend those tests instead of starting from scratch.

Feasibility conclusion:

- Client-native implementation is feasible on Electron `41.5.1`.
- iframe fallback is feasible but cannot promise full browser parity because embedding is controlled by remote site headers and browser policy.
- Fullscreen is feasible as a canvas-level state, not OS fullscreen. It should set node layout to the available canvas viewport and keep an exit control in app chrome.
- Page zoom as an end-user browser feature should not be included in the first implementation slice because current code uses `webContents.zoomFactor` to counter canvas zoom and preserve page scale. Browser page zoom needs a separate design so it does not fight `canvasZoom`.
- Browser profile data should be implemented as a local client/native profile store first. WebUI iframe mode should persist only node-level URL/frame/mode in the shared workspace state unless a later product decision explicitly makes browser profile data syncable.

Open product decision before coding:

- Whether client browser profile data such as bookmarks/history should ever sync to Worker/WebUI. The conservative plan below keeps profile data local to the client and syncs only workspace node state.

## Implementation Plan

Step 1: Browser data model and persistence.

- Add browser domain types for `BrowserProfileId`, `BrowserMode`, `BrowserHistoryEntry`, `BrowserBookmark`, `BrowserDownloadRecord`, `BrowserPermissionDecision` and any remaining profile preferences needed by the start page.
- Add SQLite tables for browser history, bookmarks, downloads and permission decisions.
- Bump `DB_SCHEMA_VERSION` and make migration idempotent.
- Add normalize/read/write APIs behind a browser profile store boundary.
- Verification: migration contract tests, old DB compatibility, unit tests for incognito exclusion and profile scoping.

Step 2: Node data migration and sizing/fullscreen rules.

- Extend `WebsiteNodeData` with `browserMode`, `isFullscreen` and `previousFrame`.
- Normalize old website nodes to `browserMode: 'native'` in Electron runtime and `iframe` only for explicit WebUI-created fallback.
- Add shared sizing helpers for normal `90%` clamp and fullscreen frame restore.
- Apply clamp in create, hydrate, resize and programmatic node updates.
- Verification: unit tests for clamp/restore; renderer tests for old node normalization; E2E resize clamp.

Step 3: Native browser runtime services.

- Split current website runtime into a browser runtime layer without changing Main ownership.
- Replace deprecated back/forward calls with `contents.navigationHistory` where safe.
- Add native operations: stop, home, find, clear/find navigation, download cancel/open-show, permission decision, bookmark/history commands.
- Add runtime event payloads for favicon, find results, download progress, permission requests and active history state.
- Keep `setWindowOpenHandler` as the single new-window route into canvas node creation.
- Verification: unit tests for runtime operation guards; contract tests for IPC validation; E2E with local HTTP server.

Step 4: Renderer browser chrome and panels.

- Evolve `WebsiteNode` into a mode-aware Browser Window UI.
- Add toolbar controls: back, forward, reload/stop, home/start page, address, bookmark star, history/bookmarks/downloads and fullscreen.
- Open page find through node-scoped `Ctrl/Cmd+F` instead of a persistent toolbar button.
- Put native/iframe runtime preference in Settings, not in each node toolbar.
- Add compact toolbar layout for small clamped sizes.
- Add permission prompt and download/status UI using app in-message/modal patterns, not `alert`.
- Add i18n keys in `en.ts` and `zh-CN.ts`.
- Verification: component tests for mode/toolbar state and E2E for main user paths.

Step 5: WebUI placeholder and iframe fallback.

- In browser runtime, do not expose native `websiteWindow` APIs.
- Render client-native synced nodes as a friendly placeholder with an explicit iframe downgrade action.
- Create WebUI browser nodes as `browserMode: 'iframe'`.
- Implement iframe navigation UI with clear blocked/unsupported states.
- Ensure WebUI never silently rewrites a native node to iframe.
- Verification: `tests/e2e-web-canvas` coverage for native placeholder, explicit iframe downgrade and iframe navigation/block state.

Step 6: Sync and conflict rules.

- Update workspace sync merge rules so node URL/frame/mode/fullscreen changes merge predictably.
- Keep browser profile store out of shared workspace sync for the first slice.
- Add guards so runtime observations cannot overwrite durable URL after the node was switched modes or closed.
- Verification: multi-client WebUI sync tests and desktop/WebUI mixed-state tests.

Step 7: Downloads, permissions and cross-platform hardening.

- Finalize download directory strategy and system show/open behavior per platform.
- Implement permission prompt lifecycle with timeout/closed-node handling.
- Add cleanup for download and permission listeners on node close/session disposal.
- Verification: platform-aware unit/contract tests; E2E download using local server; manual smoke on macOS plus CI coverage where available.

Step 8: Final verification and handoff.

- Run targeted unit/contract/integration tests as each slice lands.
- For final PR, stage changes, run `pnpm line-check:staged`, then `pnpm pre-commit`.
- Update `docs/canvas/WEBSITE_WINDOW_NODE.md` or rename/supersede it after implementation lands.
- If this is submitted as a PR, update PR body with required screenshots/recording for browser UI, fullscreen and WebUI fallback.

## Verification Plan

Lowest meaningful layers:

- Unit: URL normalization, search fallback, start-page resolution, `90%` clamp, fullscreen frame restore, incognito history exclusion.
- Contract: browser IPC payload validation, mode switch commands, bookmark/history/download payload shape.
- Integration: SQLite migration from existing website nodes, profile-scoped history/bookmark persistence, permission decision persistence.
- E2E client: navigation, history, bookmarks, start page, new window, download, permission prompt, fullscreen, restart recovery and size clamp.
- E2E WebUI: native synced placeholder, explicit iframe downgrade, iframe navigation and blocked iframe error state.

Final Large implementation must pass the repository pre-commit workflow after staging the change, including the E2E layer required for user-visible behavior.
