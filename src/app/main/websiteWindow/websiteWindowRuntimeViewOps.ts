import type { WebsiteWindowBounds, WebsiteWindowEventPayload } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'

export function captureWebsiteWindowRuntimeSnapshot({
  runtime,
  quality,
  emit,
}: {
  runtime: WebsiteWindowRuntime
  quality: number
  emit: (payload: WebsiteWindowEventPayload) => void
}): void {
  const contents = runtime.view?.webContents ?? null
  if (!contents || contents.isDestroyed()) {
    return
  }

  void contents
    .capturePage()
    .then(image => {
      const jpeg = image.toJPEG(quality)
      const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
      runtime.snapshotDataUrl = dataUrl
      emit({ type: 'snapshot', nodeId: runtime.nodeId, dataUrl })
    })
    .catch(() => undefined)
}

export function applyWebsiteWindowBounds(
  runtime: WebsiteWindowRuntime,
  bounds: WebsiteWindowBounds,
): void {
  const view = runtime.view
  if (!view) {
    return
  }

  if (bounds.width <= 0 || bounds.height <= 0) {
    view.setVisible(false)
    return
  }

  view.setVisible(true)
  view.setBounds(bounds)
}
