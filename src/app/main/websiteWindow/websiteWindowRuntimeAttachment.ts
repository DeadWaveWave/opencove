import type { BrowserWindow } from 'electron'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'

export function detachWebsiteWindowRuntimeViewFromWindow(
  runtime: WebsiteWindowRuntime,
  window: BrowserWindow,
): void {
  const hostView = runtime.hostView
  const view = runtime.view
  if (!hostView && !view) {
    return
  }

  if (!window.isDestroyed()) {
    try {
      if (hostView) {
        window.contentView.removeChildView(hostView)
      } else if (view) {
        window.contentView.removeChildView(view)
      }
    } catch {
      // ignore - window/view may already be gone during shutdown
    }
  }

  try {
    hostView?.setVisible(false)
    view?.setVisible(false)
  } catch {
    // ignore - view may already be destroyed during shutdown
  }
}

export function attachWebsiteWindowRuntimeViewToWindow(
  runtime: WebsiteWindowRuntime,
  window: BrowserWindow,
): void {
  if (window.isDestroyed()) {
    return
  }

  const hostView = runtime.hostView
  const view = runtime.view
  if (!hostView && !view) {
    return
  }

  try {
    if (hostView) {
      window.contentView.addChildView(hostView)
    } else if (view) {
      window.contentView.addChildView(view)
    }
  } catch {
    // ignore - window/view may already be gone during shutdown
  }

  try {
    hostView?.setVisible(false)
    view?.setVisible(false)
  } catch {
    // ignore - view may already be destroyed during shutdown
  }
}
