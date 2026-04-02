import { View } from 'electron'
import type { BrowserWindow, Session, WebContents } from 'electron'
import type {
  ActivateWebsiteWindowInput,
  ConfigureWebsiteWindowPolicyInput,
  NavigateWebsiteWindowInput,
  SetWebsiteWindowBoundsInput,
  SetWebsiteWindowPinnedInput,
  SetWebsiteWindowSessionInput,
  WebsiteWindowEventPayload,
  WebsiteWindowPolicy,
} from '../../../shared/contracts/dto'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import { resolveWebsiteNavigationUrl } from './websiteWindowUrl'
import { boundsEqual, normalizeBounds } from './websiteWindowBounds'
import { DEFAULT_WEBSITE_WINDOW_POLICY, normalizeWebsiteWindowPolicy } from './websiteWindowPolicy'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { ensureWebsiteWindowRuntime } from './websiteWindowRuntimeFactory'
import { normalizeWebsiteCanvasZoom } from './websiteWindowView'
import {
  applyWebsiteWindowViewportMetrics,
  captureWebsiteWindowRuntimeSnapshot,
} from './websiteWindowRuntimeViewOps'
import { ensureWebsiteWindowView } from './websiteWindowEnsureView'
import {
  disposeWebsiteWindowRuntime,
  refreshWebsiteWindowDiscardTimer,
  transitionWebsiteWindowToCold,
} from './websiteWindowLifecycle'

export class WebsiteWindowManager {
  private policy: WebsiteWindowPolicy = { ...DEFAULT_WEBSITE_WINDOW_POLICY }
  private runtimeByNodeId = new Map<string, WebsiteWindowRuntime>()
  private configuredSessions = new WeakSet<Session>()

  constructor(private window: BrowserWindow) {}

  private resolveRuntimeWebContents(runtime: WebsiteWindowRuntime): WebContents | null {
    const view = runtime.view
    if (!view) {
      return null
    }

    try {
      const contents = view.webContents
      if (contents.isDestroyed()) {
        return null
      }
      return contents
    } catch {
      return null
    }
  }

  dispose(): void {
    for (const runtime of this.runtimeByNodeId.values()) {
      disposeWebsiteWindowRuntime(runtime, this.window)
    }

    this.runtimeByNodeId.clear()
  }

  configurePolicy(payload: ConfigureWebsiteWindowPolicyInput): void {
    const normalized = normalizeWebsiteWindowPolicy(payload.policy)
    this.policy = normalized
    this.enforceActiveBudget()

    for (const runtime of this.runtimeByNodeId.values()) {
      this.refreshDiscardTimer(runtime)
    }
  }

  activate(payload: ActivateWebsiteWindowInput): void {
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

    if (runtime.bounds) {
      applyWebsiteWindowViewportMetrics({
        runtime,
        bounds: runtime.bounds,
        viewportBounds: runtime.viewportBounds,
        canvasZoom: runtime.canvasZoom,
      })
    }

    this.loadDesiredUrl(runtime)
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
    if (runtime.lifecycle === 'active') {
      applyWebsiteWindowViewportMetrics({
        runtime,
        bounds: normalizedBounds,
        viewportBounds: runtime.viewportBounds,
        canvasZoom: runtime.canvasZoom,
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
    this.loadDesiredUrl(runtime)
  }

  goBack(nodeId: string): void {
    const runtime = this.runtimeByNodeId.get(nodeId) ?? null
    const contents = runtime ? this.resolveRuntimeWebContents(runtime) : null
    if (!runtime || !contents) {
      return
    }

    if (contents.canGoBack()) {
      contents.goBack()
    }
  }

  goForward(nodeId: string): void {
    const runtime = this.runtimeByNodeId.get(nodeId) ?? null
    const contents = runtime ? this.resolveRuntimeWebContents(runtime) : null
    if (!runtime || !contents) {
      return
    }

    if (contents.canGoForward()) {
      contents.goForward()
    }
  }

  reload(nodeId: string): void {
    const runtime = this.runtimeByNodeId.get(nodeId) ?? null
    const contents = runtime ? this.resolveRuntimeWebContents(runtime) : null
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
        applyWebsiteWindowViewportMetrics({
          runtime,
          bounds: currentBounds,
          viewportBounds: currentViewportBounds,
          canvasZoom: runtime.canvasZoom,
        })
      }
      this.loadDesiredUrl(runtime)
    }
  }

  private markActive(runtime: WebsiteWindowRuntime): void {
    runtime.lastActivatedAt = Date.now()
    runtime.snapshotDataUrl = null

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
    if (!this.window.isDestroyed()) {
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
      if (this.countActive() <= maxActive) {
        break
      }

      this.transitionToWarm(runtime)
    }
  }

  private countActive(): number {
    let count = 0
    for (const runtime of this.runtimeByNodeId.values()) {
      if (runtime.lifecycle === 'active') {
        count += 1
      }
    }
    return count
  }

  private transitionToWarm(runtime: WebsiteWindowRuntime): void {
    if (runtime.lifecycle !== 'active') {
      return
    }

    captureWebsiteWindowRuntimeSnapshot({
      runtime,
      quality: 60,
      emit: payload => this.emit(payload),
    })

    runtime.lifecycle = 'warm'

    if (runtime.hostView) {
      if (!this.window.isDestroyed()) {
        try {
          this.window.contentView.removeChildView(runtime.hostView)
        } catch {
          // ignore - window/view may already be gone during shutdown
        }
      }

      try {
        runtime.hostView.setVisible(false)
      } catch {
        // ignore - view may already be destroyed during shutdown
      }
    }

    if (runtime.view) {
      try {
        runtime.view.setVisible(false)
      } catch {
        // ignore - view may already be destroyed during shutdown
      }
    }

    this.refreshDiscardTimer(runtime)
    this.emitState(runtime)
  }

  private loadDesiredUrl(runtime: WebsiteWindowRuntime): void {
    const contents = this.resolveRuntimeWebContents(runtime)
    if (!contents) {
      return
    }

    const resolved = resolveWebsiteNavigationUrl(runtime.desiredUrl)
    if (!resolved.url) {
      if (resolved.error) {
        this.emit({ type: 'error', nodeId: runtime.nodeId, message: resolved.error })
      }
      return
    }

    if (runtime.url === resolved.url) {
      return
    }

    void contents.loadURL(resolved.url).catch(error => {
      const message = error instanceof Error ? error.message : 'loadURL failed'
      this.emit({ type: 'error', nodeId: runtime.nodeId, message })
    })
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
