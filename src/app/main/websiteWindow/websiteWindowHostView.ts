import { View } from 'electron'
import type { BrowserWindow } from 'electron'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'

export function attachWebsiteWindowHostView({
  runtime,
  window,
  isOccluded,
}: {
  runtime: WebsiteWindowRuntime
  window: BrowserWindow
  isOccluded: boolean
}): void {
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

  if (!window.isDestroyed() && !isOccluded) {
    try {
      if (hostView) {
        window.contentView.addChildView(hostView)
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
}
