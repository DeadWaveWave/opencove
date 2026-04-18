import { View } from 'electron'
import type { BrowserWindow, Session } from 'electron'
import type {
  ActivateWebsiteWindowInput,
  CaptureWebsiteWindowSnapshotInput,
  ConfigureWebsiteWindowPolicyInput,
  NavigateWebsiteWindowInput,
  SetWebsiteWindowOccludedInput,
  SetWebsiteWindowBoundsInput,
  SetWebsiteWindowPinnedInput,
  SetWebsiteWindowSessionInput,
  WebsiteWindowEventPayload,
  WebsiteWindowPolicy,
} from '../../../shared/contracts/dto'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import { boundsEqual, normalizeBounds } from './websiteWindowBounds'
import { DEFAULT_WEBSITE_WINDOW_POLICY, normalizeWebsiteWindowPolicy } from './websiteWindowPolicy'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { countActiveWebsiteWindowRuntimes } from './websiteWindowActiveCount'
import {
  applyWebsiteWindowManagerOcclusionState,
  transitionAllWebsiteWindowRuntimesToCold,
} from './websiteWindowManagerOps'
import { ensureWebsiteWindowRuntime } from './websiteWindowRuntimeFactory'
import { normalizeWebsiteCanvasZoom } from './websiteWindowView'
import {
  applyWebsiteWindowViewportMetrics,
  captureWebsiteWindowRuntimeSnapshot,
  normalizeWebsiteWindowSnapshotQuality,
} from './websiteWindowRuntimeViewOps'
import { ensureWebsiteWindowView } from './websiteWindowEnsureView'
import {
  disposeWebsiteWindowRuntime,
  refreshWebsiteWindowDiscardTimer,
  transitionWebsiteWindowToWarm,
  transitionWebsiteWindowToCold,
} from './websiteWindowLifecycle'
import {
  loadWebsiteWindowRuntimeDesiredUrl,
  resolveWebsiteWindowRuntimeWebContents,
} from './websiteWindowNavigationOps'
import { resolveBrowserWindowScaleFactor } from './websiteWindowScaleFactor'
export class WebsiteWindowManager {
  private policy: WebsiteWindowPolicy = { ...DEFAULT_WEBSITE_WINDOW_POLICY }
  private runtimeByNodeId = new Map<string, WebsiteWindowRuntime>()
  private configuredSessions = new WeakSet<Session>()
  private isOccluded = false
  constructor(private window: BrowserWindow) {}
  dispose(): void {
    for (const runtime of this.runtimeByNodeId.values()) {
      disposeWebsiteWindowRuntime(runtime, this.window)
    }

    this.runtimeByNodeId.clear()
  }
  configurePolicy(payload: ConfigureWebsiteWindowPolicyInput): void {
    const normalized = normalizeWebsiteWindowPolicy(payload.policy)
    this.policy = normalized

    if (!normalized.enabled) {
      transitionAllWebsiteWindowRuntimesToCold({
        runtimes: this.runtimeByNodeId.values(),
        window: this.window,
        emit: eventPayload => this.emit(eventPayload),
        emitState: nextRuntime => this.emitState(nextRuntime),
      })
    }

    this.enforceActiveBudget()

    for (const runtime of this.runtimeByNodeId.values()) {
      this.refreshDiscardTimer(runtime)
    }
  }

  setOccluded(payload: SetWebsiteWindowOccludedInput): void {
    const nextOccluded = payload?.occluded === true
    if (nextOccluded === this.isOccluded) {
      return
    }

    this.isOccluded = nextOccluded

    applyWebsiteWindowManagerOcclusionState({
      runtimes: this.runtimeByNodeId.values(),
      nextOccluded,
      window: this.window,
      emit: eventPayload => this.emit(eventPayload),
      emitState: nextRuntime => this.emitState(nextRuntime),
    })
  }

  activate(payload: ActivateWebsiteWindowInput): void {
    if (!this.policy.enabled) {
      return
    }

    const nodeId = payload.nodeId.trim()
    if (nodeId.length === 0) {
      throw new Error('Invalid website nodeId')
    }

    const runtime = ensureWebsiteWindowRuntime({
      runtimeByNodeId: this.runtimeByNodeId,
      nodeId,
      desiredUrl: payload.url,
      pinned: payload.pinned,
      sessionMode: payload.sessionMode,
      profileId: payload.profileId,
    })

    runtime.pinned = payload.pinned === true
    runtime.sessionMode = payload.sessionMode
    runtime.profileId = payload.profileId
    runtime.desiredUrl = payload.url

    if (payload.bounds) {
      const normalized = normalizeBounds(payload.bounds)
      runtime.bounds = normalized
      if (!payload.viewportBounds) {
        runtime.viewportBounds = normalized
      }
    }

    if (payload.viewportBounds) {
      runtime.viewportBounds = normalizeBounds(payload.viewportBounds)
    }

    if (payload.canvasZoom !== undefined) {
      runtime.canvasZoom = normalizeWebsiteCanvasZoom(payload.canvasZoom)
    }

    this.markActive(runtime)

    const windowScaleFactor = resolveBrowserWindowScaleFactor(this.window)
    if (runtime.bounds && !this.isOccluded) {
      applyWebsiteWindowViewportMetrics({
        runtime,
        bounds: runtime.bounds,
        viewportBounds: runtime.viewportBounds,
        canvasZoom: runtime.canvasZoom,
        windowScaleFactor,
      })
    }

    loadWebsiteWindowRuntimeDesiredUrl({
      runtime,
      emit: eventPayload => this.emit(eventPayload),
    })
  }

  deactivate(nodeId: string): void {
    const normalized = nodeId.trim()
    if (normalized.length === 0) {
      return
    }

    const runtime = this.runtimeByNodeId.get(normalized) ?? null
    if (!runtime) {
      return
    }

    transitionWebsiteWindowToWarm({
      runtime,
      policy: this.policy,
      window: this.window,
      emit: payload => this.emit(payload),
      emitState: nextRuntime => this.emitState(nextRuntime),
    })
  }

  setBounds(payload: SetWebsiteWindowBoundsInput): void {
    const nodeId = payload.nodeId.trim()
    if (nodeId.length === 0) {
      return
    }

    const runtime = this.runtimeByNodeId.get(nodeId) ?? null
    if (!runtime) {
      return
    }

    const normalizedBounds = normalizeBounds(payload.bounds)
    const normalizedViewportBounds = payload.viewportBounds
      ? normalizeBounds(payload.viewportBounds)
      : normalizedBounds
    if (
      boundsEqual(runtime.bounds, normalizedBounds) &&
      boundsEqual(runtime.viewportBounds, normalizedViewportBounds) &&
      payload.canvasZoom === undefined
    ) {
      return
    }

    runtime.bounds = normalizedBounds
    runtime.viewportBounds = normalizedViewportBounds
    if (payload.canvasZoom !== undefined) {
      runtime.canvasZoom = normalizeWebsiteCanvasZoom(payload.canvasZoom)
    }
    if (runtime.lifecycle === 'active' && !this.isOccluded) {
      const windowScaleFactor = resolveBrowserWindowScaleFactor(this.window)
      applyWebsiteWindowViewportMetrics({
        runtime,
        bounds: normalizedBounds,
        viewportBounds: runtime.viewportBounds,
        canvasZoom: runtime.canvasZoom,
        windowScaleFactor,
      })
    }
  }

  navigate(payload: NavigateWebsiteWindowInput): void {
    const nodeId = payload.nodeId.trim()
    if (nodeId.length === 0) {
      throw new Error('Invalid website nodeId')
    }

    const runtime = this.runtimeByNodeId.get(nodeId)
    if (!runtime) {
      throw new Error('Website window not initialized')
    }

    runtime.desiredUrl = payload.url
    if (!this.policy.enabled) {
      return
    }

    loadWebsiteWindowRuntimeDesiredUrl({
      runtime,
      emit: eventPayload => this.emit(eventPayload),
    })
  }

  goBack(nodeId: string): void {
    const runtime = this.runtimeByNodeId.get(nodeId) ?? null
    const contents = runtime ? resolveWebsiteWindowRuntimeWebContents(runtime) : null
    if (!runtime || !contents) {
      return
    }

    if (contents.canGoBack()) {
      contents.goBack()
    }
  }

  goForward(nodeId: string): void {
    const runtime = this.runtimeByNodeId.get(nodeId) ?? null
    const contents = runtime ? resolveWebsiteWindowRuntimeWebContents(runtime) : null
    if (!runtime || !contents) {
      return
    }

    if (contents.canGoForward()) {
      contents.goForward()
    }
  }

  reload(nodeId: string): void {
    const runtime = this.runtimeByNodeId.get(nodeId) ?? null
    const contents = runtime ? resolveWebsiteWindowRuntimeWebContents(runtime) : null
    if (!runtime || !contents) {
      return
    }

    contents.reload()
  }

  close(nodeId: string): void {
    const normalized = nodeId.trim()
    if (normalized.length === 0) {
      return
    }

    const runtime = this.runtimeByNodeId.get(normalized) ?? null
    if (!runtime) {
      return
    }

    disposeWebsiteWindowRuntime(runtime, this.window)
    this.runtimeByNodeId.delete(normalized)
    this.emit({ type: 'closed', nodeId: normalized })
  }

  setPinned(payload: SetWebsiteWindowPinnedInput): void {
    const nodeId = payload.nodeId.trim()
    if (nodeId.length === 0) {
      return
    }

    const runtime = this.runtimeByNodeId.get(nodeId) ?? null
    if (!runtime) {
      return
    }

    runtime.pinned = payload.pinned === true
    this.refreshDiscardTimer(runtime)
    this.enforceActiveBudget()
    this.emitState(runtime)
  }

  setSession(payload: SetWebsiteWindowSessionInput): void {
    const nodeId = payload.nodeId.trim()
    if (nodeId.length === 0) {
      return
    }

    const runtime = this.runtimeByNodeId.get(nodeId) ?? null
    if (!runtime) {
      return
    }

    runtime.sessionMode = payload.sessionMode
    runtime.profileId = payload.profileId

    const wasActive = runtime.lifecycle === 'active'
    const currentBounds = runtime.bounds
    const currentViewportBounds = runtime.viewportBounds
    const currentUrl = runtime.desiredUrl

    transitionWebsiteWindowToCold({
      runtime,
      window: this.window,
      captureSnapshot: false,
      emit: eventPayload => this.emit(eventPayload),
      emitState: nextRuntime => this.emitState(nextRuntime),
    })
    runtime.desiredUrl = currentUrl

    if (wasActive) {
      this.markActive(runtime)
      if (currentBounds) {
        const windowScaleFactor = resolveBrowserWindowScaleFactor(this.window)
        applyWebsiteWindowViewportMetrics({
          runtime,
          bounds: currentBounds,
          viewportBounds: currentViewportBounds,
          canvasZoom: runtime.canvasZoom,
          windowScaleFactor,
        })
      }
      loadWebsiteWindowRuntimeDesiredUrl({
        runtime,
        emit: eventPayload => this.emit(eventPayload),
      })
    }
  }

  captureSnapshot(payload: CaptureWebsiteWindowSnapshotInput): void {
    const nodeId = typeof payload?.nodeId === 'string' ? payload.nodeId.trim() : ''
    if (nodeId.length === 0) {
      return
    }

    const runtime = this.runtimeByNodeId.get(nodeId) ?? null
    if (!runtime) {
      return
    }

    captureWebsiteWindowRuntimeSnapshot({
      runtime,
      quality: normalizeWebsiteWindowSnapshotQuality(payload.quality),
      emit: eventPayload => this.emit(eventPayload),
    })
  }

  private markActive(runtime: WebsiteWindowRuntime): void {
    runtime.lastActivatedAt = Date.now()

    if (runtime.lifecycle !== 'active') {
      runtime.lifecycle = 'active'
    }

    ensureWebsiteWindowView({
      runtime,
      configuredSessions: this.configuredSessions,
      emitState: nextRuntime => this.emitState(nextRuntime),
      emit: payload => this.emit(payload),
    })

    const view = runtime.view
    if (!view) {
      throw new Error('Failed to create WebContentsView for website window')
    }

    if (!runtime.hostView) {
      const hostView = new View()
      hostView.setBackgroundColor('#00000000')
      runtime.hostView = hostView
    }

    const hostView = runtime.hostView
    if (hostView) {
      try {
        hostView.addChildView(view)
      } catch {
        // ignore - view may already be gone during shutdown
      }
    }

    this.refreshDiscardTimer(runtime)
    if (!this.window.isDestroyed() && !this.isOccluded) {
      try {
        if (hostView) {
          this.window.contentView.addChildView(hostView)
        }
      } catch {
        // ignore - window/view may already be gone during shutdown
      }

      try {
        hostView?.setVisible(false)
        view.setVisible(false)
      } catch {
        // ignore - view may already be destroyed during shutdown
      }
    }

    this.enforceActiveBudget(runtime.nodeId)
    this.emitState(runtime)
  }

  private enforceActiveBudget(exemptNodeId?: string): void {
    const maxActive = this.policy.maxActiveCount
    const active: WebsiteWindowRuntime[] = []

    for (const runtime of this.runtimeByNodeId.values()) {
      if (runtime.lifecycle === 'active') {
        active.push(runtime)
      }
    }

    if (active.length <= maxActive) {
      return
    }

    active.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? 1 : -1
      }

      return a.lastActivatedAt - b.lastActivatedAt
    })

    const candidates = active.filter(item => item.nodeId !== exemptNodeId)
    for (const runtime of candidates) {
      if (countActiveWebsiteWindowRuntimes(this.runtimeByNodeId.values()) <= maxActive) {
        break
      }

      transitionWebsiteWindowToWarm({
        runtime,
        policy: this.policy,
        window: this.window,
        emit: payload => this.emit(payload),
        emitState: nextRuntime => this.emitState(nextRuntime),
      })
    }
  }
  private refreshDiscardTimer(runtime: WebsiteWindowRuntime): void {
    refreshWebsiteWindowDiscardTimer({
      runtime,
      policy: this.policy,
      window: this.window,
      emit: payload => this.emit(payload),
      emitState: nextRuntime => this.emitState(nextRuntime),
    })
  }
  private emitState(runtime: WebsiteWindowRuntime): void {
    this.emit({
      type: 'state',
      nodeId: runtime.nodeId,
      lifecycle: runtime.lifecycle,
      isOccluded: this.isOccluded,
      url: runtime.url,
      title: runtime.title,
      isLoading: runtime.isLoading,
      canGoBack: runtime.canGoBack,
      canGoForward: runtime.canGoForward,
    })
  }
  private emit(payload: WebsiteWindowEventPayload): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }
    const contents = this.window.webContents
    if (contents.isDestroyed()) {
      return
    }
    contents.send(IPC_CHANNELS.websiteWindowEvent, payload)
  }
}
