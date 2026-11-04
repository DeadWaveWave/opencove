import type { Terminal } from '@xterm/xterm'
import { setTerminalViewportZoom } from './effectiveDevicePixelRatio'
import { setTerminalRasterViewportZoom } from './terminalRasterScaleController'

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

export function applyTerminalViewportZoom(target: Terminal | null, viewportZoom: number): void {
  const terminal = target as
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
  setTerminalRasterViewportZoom(terminal, viewportZoom)
}
