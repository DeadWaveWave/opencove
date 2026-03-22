import type { Terminal } from '@xterm/xterm'

type XtermMouseService = {
  getCoords: (
    event: { clientX: number; clientY: number },
    element: HTMLElement,
    colCount: number,
    rowCount: number,
    isSelection?: boolean,
  ) => [number, number] | undefined
  getMouseReportCoords?: (
    event: { clientX: number; clientY: number },
    element: HTMLElement,
  ) =>
    | {
        col: number
        row: number
        x: number
        y: number
      }
    | undefined
  __opencovePatched?: boolean
}

function resolveElementScale({ element, rect }: { element: HTMLElement; rect: DOMRect }): {
  scaleX: number
  scaleY: number
} {
  const width = element.offsetWidth
  const height = element.offsetHeight

  const scaleX = width > 0 && rect.width > 0 ? rect.width / width : 1
  const scaleY = height > 0 && rect.height > 0 ? rect.height / height : 1

  return {
    scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
    scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
  }
}

function parsePadding(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function getScaledPixelsRelativeToElement({
  event,
  element,
}: {
  event: { clientX: number; clientY: number }
  element: HTMLElement
}): [number, number] {
  const rect = element.getBoundingClientRect()
  const { scaleX, scaleY } = resolveElementScale({ element, rect })

  const elementStyle = window.getComputedStyle(element)
  const leftPadding = parsePadding(elementStyle.getPropertyValue('padding-left'))
  const topPadding = parsePadding(elementStyle.getPropertyValue('padding-top'))

  return [
    (event.clientX - rect.left) / scaleX - leftPadding,
    (event.clientY - rect.top) / scaleY - topPadding,
  ]
}

function getScaledTerminalCoords({
  event,
  element,
  isSelection,
  cssCellWidth,
  cssCellHeight,
  colCount,
  rowCount,
}: {
  event: { clientX: number; clientY: number }
  element: HTMLElement
  isSelection: boolean
  cssCellWidth: number
  cssCellHeight: number
  colCount: number
  rowCount: number
}): [number, number] | undefined {
  if (!Number.isFinite(cssCellWidth) || cssCellWidth <= 0) {
    return undefined
  }

  if (!Number.isFinite(cssCellHeight) || cssCellHeight <= 0) {
    return undefined
  }

  const [relativeX, relativeY] = getScaledPixelsRelativeToElement({ event, element })

  const normalizedX = Math.ceil((relativeX + (isSelection ? cssCellWidth / 2 : 0)) / cssCellWidth)
  const normalizedY = Math.ceil(relativeY / cssCellHeight)

  const clampedX = Math.min(Math.max(normalizedX, 1), colCount + (isSelection ? 1 : 0))
  const clampedY = Math.min(Math.max(normalizedY, 1), rowCount)

  return [clampedX, clampedY]
}

export function patchXtermMouseService(terminal: Terminal): boolean {
  const core = terminal as unknown as {
    _core?: {
      _mouseService?: XtermMouseService
      _renderService?: {
        dimensions?: {
          css?: {
            cell?: { width?: number; height?: number }
            canvas?: { width?: number; height?: number }
          }
        }
      }
      _charSizeService?: { hasValidSize?: boolean }
    }
  }

  const mouseService = core._core?._mouseService
  if (!mouseService || typeof mouseService.getCoords !== 'function') {
    return false
  }

  if (mouseService.__opencovePatched) {
    return true
  }

  const charSizeService = core._core?._charSizeService
  const renderService = core._core?._renderService
  if (!renderService || !charSizeService) {
    return false
  }

  mouseService.__opencovePatched = true

  const originalGetCoords = mouseService.getCoords.bind(mouseService)
  mouseService.getCoords = (event, element, colCount, rowCount, isSelection = false) => {
    if (!charSizeService.hasValidSize) {
      return undefined
    }

    const cssCellWidth = renderService.dimensions?.css?.cell?.width ?? 0
    const cssCellHeight = renderService.dimensions?.css?.cell?.height ?? 0

    return (
      getScaledTerminalCoords({
        event,
        element,
        isSelection,
        cssCellWidth,
        cssCellHeight,
        colCount,
        rowCount,
      }) ?? originalGetCoords(event, element, colCount, rowCount, isSelection)
    )
  }

  const originalGetMouseReportCoords =
    typeof mouseService.getMouseReportCoords === 'function'
      ? mouseService.getMouseReportCoords.bind(mouseService)
      : null

  if (!originalGetMouseReportCoords) {
    return true
  }

  mouseService.getMouseReportCoords = (event, element) => {
    if (!charSizeService.hasValidSize) {
      return undefined
    }

    const cssCellWidth = renderService.dimensions?.css?.cell?.width ?? 0
    const cssCellHeight = renderService.dimensions?.css?.cell?.height ?? 0

    if (!Number.isFinite(cssCellWidth) || cssCellWidth <= 0) {
      return originalGetMouseReportCoords(event, element)
    }

    if (!Number.isFinite(cssCellHeight) || cssCellHeight <= 0) {
      return originalGetMouseReportCoords(event, element)
    }

    const [x, y] = getScaledPixelsRelativeToElement({ event, element })

    const canvasWidth = renderService.dimensions?.css?.canvas?.width ?? 0
    const canvasHeight = renderService.dimensions?.css?.canvas?.height ?? 0

    const clampedX =
      Number.isFinite(canvasWidth) && canvasWidth > 0
        ? Math.min(Math.max(x, 0), canvasWidth - 1)
        : x
    const clampedY =
      Number.isFinite(canvasHeight) && canvasHeight > 0
        ? Math.min(Math.max(y, 0), canvasHeight - 1)
        : y

    return {
      col: Math.floor(clampedX / cssCellWidth),
      row: Math.floor(clampedY / cssCellHeight),
      x: Math.floor(clampedX),
      y: Math.floor(clampedY),
    }
  }

  return true
}

export function patchXtermMouseServiceWithRetry(
  terminal: Terminal,
  options: { maxAttempts?: number } = {},
): () => void {
  if (typeof window === 'undefined') {
    patchXtermMouseService(terminal)
    return () => undefined
  }

  const maxAttempts = options.maxAttempts ?? 30
  let cancelled = false
  let frame: number | null = null

  const tryPatch = (attempt: number) => {
    if (cancelled) {
      return
    }

    if (patchXtermMouseService(terminal)) {
      return
    }

    if (attempt >= maxAttempts) {
      return
    }

    frame = window.requestAnimationFrame(() => {
      tryPatch(attempt + 1)
    })
  }

  tryPatch(0)

  return () => {
    cancelled = true
    if (frame !== null) {
      window.cancelAnimationFrame(frame)
    }
  }
}
