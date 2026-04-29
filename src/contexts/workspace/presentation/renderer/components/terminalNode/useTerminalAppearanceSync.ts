import { useEffect, useRef, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { DEFAULT_TERMINAL_FONT_FAMILY } from './constants'
import {
  setTerminalViewportInteractionActive,
  setTerminalViewportZoom,
} from './effectiveDevicePixelRatio'

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

export function useTerminalAppearanceSync({
  terminalRef,
  syncTerminalSize,
  commitTerminalGeometry,
  terminalFontSize,
  terminalFontFamily,
  width,
  height,
  viewportZoom,
  isViewportInteractionActive,
}: {
  terminalRef: RefObject<Terminal | null>
  syncTerminalSize: () => void
  commitTerminalGeometry: () => void
  terminalFontSize: number
  terminalFontFamily: string | null
  width: number
  height: number
  viewportZoom: number
  isViewportInteractionActive: boolean
}): void {
  const hasInitializedFontSizeRef = useRef(false)
  const hasInitializedFontFamilyRef = useRef(false)

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    terminal.options.fontSize = terminalFontSize
    const frame = requestAnimationFrame(() => {
      if (hasInitializedFontSizeRef.current) {
        commitTerminalGeometry()
        return
      }

      hasInitializedFontSizeRef.current = true
      syncTerminalSize()
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [commitTerminalGeometry, syncTerminalSize, terminalFontSize, terminalRef])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    terminal.options.fontFamily = terminalFontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY
    const frame = requestAnimationFrame(() => {
      if (hasInitializedFontFamilyRef.current) {
        commitTerminalGeometry()
        return
      }

      hasInitializedFontFamilyRef.current = true
      syncTerminalSize()
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [commitTerminalGeometry, syncTerminalSize, terminalFontFamily, terminalRef])

  useEffect(() => {
    const frame = requestAnimationFrame(syncTerminalSize)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [height, syncTerminalSize, width])

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
  }, [terminalRef, viewportZoom])
}
