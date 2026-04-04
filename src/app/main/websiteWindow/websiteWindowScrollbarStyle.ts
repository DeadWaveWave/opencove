import type { WebContents } from 'electron'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'

const BASE_SCROLLBAR_SIZE_PX = 10
const MIN_SCROLLBAR_SIZE_PX = 4
const MAX_SCROLLBAR_SIZE_PX = 12

function resolveWebsiteScrollbarSizePx(canvasZoom: number): number {
  if (!Number.isFinite(canvasZoom) || canvasZoom <= 0) {
    return BASE_SCROLLBAR_SIZE_PX
  }

  const resolved = Math.round(BASE_SCROLLBAR_SIZE_PX / Math.max(1, canvasZoom))
  return Math.min(MAX_SCROLLBAR_SIZE_PX, Math.max(MIN_SCROLLBAR_SIZE_PX, resolved))
}

function resolveWebsiteScrollbarCss(sizePx: number): string {
  return `
/* opencove website window scrollbar scaling */
::-webkit-scrollbar {
  width: ${sizePx}px !important;
  height: ${sizePx}px !important;
}
::-webkit-scrollbar-track {
  background: transparent !important;
}
::-webkit-scrollbar-corner {
  background: transparent !important;
}
::-webkit-scrollbar-thumb {
  background-color: rgba(120, 120, 120, 0.75) !important;
  border-radius: 999px !important;
}
::-webkit-scrollbar-thumb:hover {
  background-color: rgba(120, 120, 120, 0.9) !important;
}
`.trim()
}

export function syncWebsiteWindowScrollbarStyle({
  runtime,
  contents,
  canvasZoom,
}: {
  runtime: WebsiteWindowRuntime
  contents: WebContents
  canvasZoom: number
}): void {
  if (contents.isDestroyed() || typeof contents.insertCSS !== 'function') {
    return
  }

  const resolvedSizePx = resolveWebsiteScrollbarSizePx(canvasZoom)
  if (runtime.scrollbarCssSizePx === resolvedSizePx) {
    return
  }

  runtime.scrollbarCssSizePx = resolvedSizePx
  runtime.scrollbarCssVersion += 1

  const version = runtime.scrollbarCssVersion
  const previousKey = runtime.scrollbarCssKey
  runtime.scrollbarCssKey = null

  void (async () => {
    if (contents.isDestroyed()) {
      return
    }

    if (previousKey && typeof contents.removeInsertedCSS === 'function') {
      try {
        await contents.removeInsertedCSS(previousKey)
      } catch {
        // ignore - css might not be present after navigation
      }
    }

    if (contents.isDestroyed()) {
      return
    }

    try {
      const key = await contents.insertCSS(resolveWebsiteScrollbarCss(resolvedSizePx))
      if (contents.isDestroyed()) {
        return
      }

      if (runtime.scrollbarCssVersion !== version) {
        if (typeof contents.removeInsertedCSS === 'function') {
          try {
            await contents.removeInsertedCSS(key)
          } catch {
            // ignore
          }
        }
        return
      }

      runtime.scrollbarCssKey = key
    } catch {
      // ignore - some pages might reject style injection
    }
  })()
}
