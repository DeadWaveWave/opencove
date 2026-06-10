import { useEffect, useRef, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { DEFAULT_TERMINAL_FONT_FAMILY } from './constants'
import {
  setTerminalViewportInteractionActive,
  setTerminalViewportZoom,
} from './effectiveDevicePixelRatio'
import {
  captureTerminalDiagnosticsSnapshot,
  captureTerminalLayoutDiagnostics,
  createTerminalDiagnosticsLogger,
} from './diagnostics'

function isTerminalAtBottom(terminal: Terminal): boolean {
  const activeBuffer = terminal.buffer?.active
  if (
    typeof activeBuffer?.baseY === 'number' &&
    typeof activeBuffer?.viewportY === 'number' &&
    Number.isFinite(activeBuffer.baseY) &&
    Number.isFinite(activeBuffer.viewportY)
  ) {
    return activeBuffer.viewportY >= activeBuffer.baseY
  }

  const viewportElement =
    terminal.element?.querySelector('.xterm-viewport') instanceof HTMLElement
      ? (terminal.element.querySelector('.xterm-viewport') as HTMLElement)
      : null
  if (!viewportElement) {
    return true
  }

  const maxScrollTop = viewportElement.scrollHeight - viewportElement.clientHeight
  if (!Number.isFinite(maxScrollTop) || maxScrollTop <= 0) {
    return true
  }

  return viewportElement.scrollTop >= maxScrollTop - 2
}

function isTerminalDiagnosticsEnabled(): boolean {
  return window.opencoveApi?.meta?.enableTerminalDiagnostics === true
}

function logAppearanceSyncDiagnostics({
  event,
  terminal,
  details,
}: {
  event: string
  terminal: Terminal
  details: Record<string, string | number | boolean | null>
}): void {
  if (!isTerminalDiagnosticsEnabled()) {
    return
  }

  const container =
    terminal.element?.closest('.terminal-node__terminal') instanceof HTMLElement
      ? (terminal.element.closest('.terminal-node__terminal') as HTMLElement)
      : null
  const viewportElement =
    terminal.element?.querySelector('.xterm-viewport') instanceof HTMLElement
      ? (terminal.element.querySelector('.xterm-viewport') as HTMLElement)
      : null
  const logger = createTerminalDiagnosticsLogger({
    enabled: true,
    emit: window.opencoveApi?.debug?.logTerminalDiagnostics ?? (() => undefined),
    base: {
      source: 'renderer-terminal',
      nodeId: 'unknown',
      sessionId: 'unknown',
      nodeKind: 'terminal',
      title: 'appearance-sync',
    },
  })

  logger.log(event, captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
    ...captureTerminalLayoutDiagnostics({ terminal, container }),
    ...details,
  })
}

export function useTerminalAppearanceSync({
  terminalRef,
  syncTerminalSize,
  commitTerminalGeometry,
  terminalFontSize,
  displayTerminalFontSize = terminalFontSize,
  displayTerminalLineHeight = 1,
  displayTerminalLetterSpacing = 0,
  commitInitialDisplayGeometry = false,
  terminalFontFamily,
  width,
  height,
  viewportZoom,
  isViewportInteractionActive,
}: {
  terminalRef: RefObject<Terminal | null>
  syncTerminalSize: (options?: { force?: boolean }) => void
  commitTerminalGeometry: () => void
  terminalFontSize: number
  displayTerminalFontSize?: number
  displayTerminalLineHeight?: number
  displayTerminalLetterSpacing?: number
  commitInitialDisplayGeometry?: boolean
  terminalFontFamily: string | null
  width: number
  height: number
  viewportZoom: number
  isViewportInteractionActive: boolean
}): void {
  const hasInitializedDisplayMetricsRef = useRef(false)
  const hasInitializedFontFamilyRef = useRef(false)
  const previousSharedFontSizeRef = useRef(terminalFontSize)
  const previousDisplayFontSizeRef = useRef(displayTerminalFontSize)
  const previousDisplayLineHeightRef = useRef(displayTerminalLineHeight)
  const previousDisplayLetterSpacingRef = useRef(displayTerminalLetterSpacing)
  const previousSharedFontFamilyRef = useRef(terminalFontFamily)
  const previousFrameSizeRef = useRef<{ width: number; height: number } | null>(null)
  const previousViewportZoomRef = useRef(viewportZoom)
  const syncTerminalSizeRef = useRef(syncTerminalSize)
  const commitTerminalGeometryRef = useRef(commitTerminalGeometry)

  syncTerminalSizeRef.current = syncTerminalSize
  commitTerminalGeometryRef.current = commitTerminalGeometry

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    const sharedFontSizeChanged = previousSharedFontSizeRef.current !== terminalFontSize
    const displayFontSizeChanged = previousDisplayFontSizeRef.current !== displayTerminalFontSize
    previousSharedFontSizeRef.current = terminalFontSize
    previousDisplayFontSizeRef.current = displayTerminalFontSize
    const displayLineHeightChanged =
      previousDisplayLineHeightRef.current !== displayTerminalLineHeight
    const displayLetterSpacingChanged =
      previousDisplayLetterSpacingRef.current !== displayTerminalLetterSpacing
    previousDisplayLineHeightRef.current = displayTerminalLineHeight
    previousDisplayLetterSpacingRef.current = displayTerminalLetterSpacing
    terminal.options.fontSize = displayTerminalFontSize
    terminal.options.lineHeight = displayTerminalLineHeight
    terminal.options.letterSpacing = displayTerminalLetterSpacing
    logAppearanceSyncDiagnostics({
      event: 'appearance-display-metrics-applied',
      terminal,
      details: {
        terminalFontSize,
        displayTerminalFontSize,
        displayFontSizeChanged,
        sharedFontSizeChanged,
        displayTerminalLineHeight,
        displayLineHeightChanged,
        displayTerminalLetterSpacing,
        displayLetterSpacingChanged,
      },
    })

    const frame = requestAnimationFrame(() => {
      if (hasInitializedDisplayMetricsRef.current && sharedFontSizeChanged) {
        commitTerminalGeometryRef.current()
        return
      }

      if (
        hasInitializedDisplayMetricsRef.current &&
        (displayFontSizeChanged || displayLineHeightChanged || displayLetterSpacingChanged)
      ) {
        commitTerminalGeometryRef.current()
        return
      }

      hasInitializedDisplayMetricsRef.current = true
      if (commitInitialDisplayGeometry) {
        commitTerminalGeometryRef.current()
        return
      }

      syncTerminalSizeRef.current()
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [
    commitInitialDisplayGeometry,
    displayTerminalFontSize,
    displayTerminalLetterSpacing,
    displayTerminalLineHeight,
    terminalFontSize,
    terminalRef,
  ])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    const sharedFontFamilyChanged = previousSharedFontFamilyRef.current !== terminalFontFamily
    previousSharedFontFamilyRef.current = terminalFontFamily
    terminal.options.fontFamily = terminalFontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY
    logAppearanceSyncDiagnostics({
      event: 'appearance-font-family-applied',
      terminal,
      details: {
        terminalFontFamily: terminalFontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
        sharedFontFamilyChanged,
      },
    })
    const frame = requestAnimationFrame(() => {
      if (hasInitializedFontFamilyRef.current && sharedFontFamilyChanged) {
        commitTerminalGeometryRef.current()
        return
      }

      hasInitializedFontFamilyRef.current = true
      syncTerminalSizeRef.current()
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [terminalFontFamily, terminalRef])

  useEffect(() => {
    const previousFrameSize = previousFrameSizeRef.current
    previousFrameSizeRef.current = { width, height }
    const frame = requestAnimationFrame(() => {
      if (
        previousFrameSize !== null &&
        (previousFrameSize.width !== width || previousFrameSize.height !== height)
      ) {
        commitTerminalGeometryRef.current()
        return
      }

      syncTerminalSizeRef.current()
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [height, width])

  useEffect(() => {
    setTerminalViewportInteractionActive(terminalRef.current, isViewportInteractionActive)
  }, [isViewportInteractionActive, terminalRef])

  useEffect(() => {
    const terminal = terminalRef.current as
      | (Terminal & {
          __opencoveDprDebug?: {
            hookLastZoom?: number | null
            hookAtBottom?: boolean | null
            hookViewportY?: number | null
            hookBaseY?: number | null
          }
        })
      | null
    if (!terminal) {
      return
    }

    const currentBuffer = terminal.buffer?.active
    terminal.__opencoveDprDebug = {
      ...(terminal.__opencoveDprDebug ?? {}),
      hookLastZoom: viewportZoom,
      hookAtBottom: isTerminalAtBottom(terminal),
      hookViewportY:
        typeof currentBuffer?.viewportY === 'number' && Number.isFinite(currentBuffer.viewportY)
          ? currentBuffer.viewportY
          : null,
      hookBaseY:
        typeof currentBuffer?.baseY === 'number' && Number.isFinite(currentBuffer.baseY)
          ? currentBuffer.baseY
          : null,
    }

    setTerminalViewportZoom(terminal, viewportZoom)

    const previousViewportZoom = previousViewportZoomRef.current
    previousViewportZoomRef.current = viewportZoom
    if (previousViewportZoom === viewportZoom) {
      return
    }

    // Schedule refresh in next two frames to ensure DPR change and render updates have completed
    let frame1: number | null = null
    let frame2: number | null = null

    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        // Force refresh after viewport zoom change to ensure DOM renderer updates
        syncTerminalSizeRef.current({ force: true })
      })
    })

    return () => {
      if (frame1 !== null) {
        cancelAnimationFrame(frame1)
      }
      if (frame2 !== null) {
        cancelAnimationFrame(frame2)
      }
    }
  }, [terminalRef, viewportZoom])
}
