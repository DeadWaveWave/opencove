import type { BrowserWindow } from 'electron'
import type { WebsiteWindowEventPayload } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import {
  captureWebsiteWindowRuntimeSnapshot,
  flushPendingWebsiteWindowRuntimeSnapshot,
} from './websiteWindowRuntimeViewOps'
import { transitionWebsiteWindowToCold } from './websiteWindowLifecycle'
import {
  attachWebsiteWindowRuntimeViewToWindow,
  detachWebsiteWindowRuntimeViewFromWindow,
} from './websiteWindowRuntimeAttachment'
import { applyWebsiteWindowViewportMetrics } from './websiteWindowRuntimeViewOps'
import { resolveBrowserWindowScaleFactor } from './websiteWindowScaleFactor'

export function transitionAllWebsiteWindowRuntimesToCold({
  runtimes,
  window,
  emit,
  emitState,
}: {
  runtimes: Iterable<WebsiteWindowRuntime>
  window: BrowserWindow
  emit: (payload: WebsiteWindowEventPayload) => void
  emitState: (runtime: WebsiteWindowRuntime) => void
}): void {
  for (const runtime of runtimes) {
    transitionWebsiteWindowToCold({
      runtime,
      window,
      captureSnapshot: runtime.lifecycle === 'active',
      emit,
      emitState,
    })
  }
}

export function applyWebsiteWindowManagerOcclusionState({
  runtimes,
  nextOccluded,
  window,
  emit,
  emitState,
}: {
  runtimes: Iterable<WebsiteWindowRuntime>
  nextOccluded: boolean
  window: BrowserWindow
  emit: (payload: WebsiteWindowEventPayload) => void
  emitState: (runtime: WebsiteWindowRuntime) => void
}): void {
  if (nextOccluded) {
    for (const runtime of runtimes) {
      if (runtime.lifecycle === 'active') {
        captureWebsiteWindowRuntimeSnapshot({
          runtime,
          quality: 58,
          emit,
        })
      }
      detachWebsiteWindowRuntimeViewFromWindow(runtime, window)
    }
  } else {
    const windowScaleFactor = resolveBrowserWindowScaleFactor(window)
    for (const runtime of runtimes) {
      if (runtime.lifecycle !== 'active') {
        continue
      }

      attachWebsiteWindowRuntimeViewToWindow(runtime, window)
      if (runtime.bounds) {
        applyWebsiteWindowViewportMetrics({
          runtime,
          bounds: runtime.bounds,
          viewportBounds: runtime.viewportBounds,
          canvasZoom: runtime.canvasZoom,
          windowScaleFactor,
        })
      }
      flushPendingWebsiteWindowRuntimeSnapshot({ runtime, emit })
    }
  }

  for (const runtime of runtimes) {
    emitState(runtime)
  }
}
