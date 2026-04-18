import type { WebContents } from 'electron'
import type { WebsiteWindowEventPayload } from '../../../shared/contracts/dto'
import { resolveWebsiteNavigationUrl } from './websiteWindowUrl'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'

export function resolveWebsiteWindowRuntimeWebContents(
  runtime: WebsiteWindowRuntime,
): WebContents | null {
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

export function loadWebsiteWindowRuntimeDesiredUrl({
  runtime,
  emit,
}: {
  runtime: WebsiteWindowRuntime
  emit: (payload: WebsiteWindowEventPayload) => void
}): void {
  const contents = resolveWebsiteWindowRuntimeWebContents(runtime)
  if (!contents) {
    return
  }

  const resolved = resolveWebsiteNavigationUrl(runtime.desiredUrl)
  if (!resolved.url) {
    if (resolved.error) {
      emit({ type: 'error', nodeId: runtime.nodeId, message: resolved.error })
    }
    return
  }

  if (runtime.url === resolved.url) {
    return
  }

  void contents.loadURL(resolved.url).catch(error => {
    const message = error instanceof Error ? error.message : 'loadURL failed'
    emit({ type: 'error', nodeId: runtime.nodeId, message })
  })
}
