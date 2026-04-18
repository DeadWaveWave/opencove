import type { Terminal } from '@xterm/xterm'
import { peekCachedTerminalScreenState } from './screenStateCache'

type TerminalSelectionHandle = Pick<
  Terminal,
  'clearSelection' | 'getSelection' | 'hasSelection' | 'selectAll' | 'cols' | 'rows' | 'element'
>

type TerminalSelectionTestApi = {
  clearSelection: (nodeId: string) => boolean
  getCellCenter: (nodeId: string, col: number, row: number) => { x: number; y: number } | null
  getFontOptions: (nodeId: string) => { fontSize: number | null; fontFamily: string | null } | null
  getSize: (nodeId: string) => { cols: number; rows: number } | null
  getViewportY: (nodeId: string) => number | null
  getCachedScreenStateSummary: (nodeId: string) => {
    sessionId: string
    serializedLength: number
    rawSnapshotLength: number
    serializedHasFrameToken: boolean
    rawSnapshotHasFrameToken: boolean
  } | null
  emitBinaryInput: (nodeId: string, data: string) => boolean
  getSelection: (nodeId: string) => string | null
  hasSelection: (nodeId: string) => boolean
  selectAll: (nodeId: string) => boolean
}

declare global {
  interface Window {
    __opencoveTerminalSelectionTestApi?: TerminalSelectionTestApi
  }
}

const terminalHandles = new Map<string, TerminalSelectionHandle>()

function getTerminalSelectionTestApi(): TerminalSelectionTestApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  if (!window.__opencoveTerminalSelectionTestApi) {
    window.__opencoveTerminalSelectionTestApi = {
      clearSelection: nodeId => {
        const terminal = terminalHandles.get(nodeId)
        if (!terminal) {
          return false
        }

        terminal.clearSelection()
        return true
      },
      getCellCenter: (nodeId, col, row) => {
        const terminal = terminalHandles.get(nodeId)
        if (!terminal) {
          return null
        }

        const root = terminal.element
        if (!root) {
          return null
        }

        const screen = root.querySelector('.xterm-screen')
        if (!(screen instanceof HTMLElement)) {
          return null
        }

        const core = terminal as unknown as {
          _core?: {
            _renderService?: {
              dimensions?: {
                css?: {
                  cell?: { width?: number; height?: number }
                }
              }
            }
          }
        }

        const cellWidth = core._core?._renderService?.dimensions?.css?.cell?.width ?? 0
        const cellHeight = core._core?._renderService?.dimensions?.css?.cell?.height ?? 0

        if (!Number.isFinite(cellWidth) || cellWidth <= 0) {
          return null
        }

        if (!Number.isFinite(cellHeight) || cellHeight <= 0) {
          return null
        }

        const clampedCol = Math.min(Math.max(Math.round(col), 1), terminal.cols)
        const clampedRow = Math.min(Math.max(Math.round(row), 1), terminal.rows)

        const rect = screen.getBoundingClientRect()
        const scaleX =
          screen.offsetWidth > 0 && rect.width > 0 ? rect.width / screen.offsetWidth : 1
        const scaleY =
          screen.offsetHeight > 0 && rect.height > 0 ? rect.height / screen.offsetHeight : 1

        const style = window.getComputedStyle(screen)
        const leftPadding = Number.parseInt(style.getPropertyValue('padding-left'), 10) || 0
        const topPadding = Number.parseInt(style.getPropertyValue('padding-top'), 10) || 0

        return {
          x: rect.left + (leftPadding + (clampedCol - 0.5) * cellWidth) * scaleX,
          y: rect.top + (topPadding + (clampedRow - 0.5) * cellHeight) * scaleY,
        }
      },
      getFontOptions: nodeId => {
        const terminal = terminalHandles.get(nodeId) as unknown as {
          options?: { fontSize?: unknown; fontFamily?: unknown }
        }
        const options = terminal?.options
        if (!options) {
          return null
        }

        return {
          fontSize:
            typeof options.fontSize === 'number' && Number.isFinite(options.fontSize)
              ? options.fontSize
              : null,
          fontFamily: typeof options.fontFamily === 'string' ? options.fontFamily : null,
        }
      },
      getSize: nodeId => {
        const terminal = terminalHandles.get(nodeId)
        if (!terminal) {
          return null
        }

        return {
          cols: terminal.cols,
          rows: terminal.rows,
        }
      },
      getViewportY: nodeId => {
        const terminal = terminalHandles.get(nodeId) as unknown as {
          buffer?: { active?: { viewportY?: unknown } }
        }
        const viewportY = terminal?.buffer?.active?.viewportY
        return typeof viewportY === 'number' && Number.isFinite(viewportY) ? viewportY : null
      },
      getCachedScreenStateSummary: nodeId => {
        const cached = peekCachedTerminalScreenState(nodeId)
        if (!cached) {
          return null
        }

        return {
          sessionId: cached.sessionId,
          serializedLength: cached.serialized.length,
          rawSnapshotLength: cached.rawSnapshot.length,
          serializedHasFrameToken: cached.serialized.includes('FRAME_29999_TOKEN'),
          rawSnapshotHasFrameToken: cached.rawSnapshot.includes('FRAME_29999_TOKEN'),
        }
      },
      emitBinaryInput: (nodeId, data) => {
        const terminal = terminalHandles.get(nodeId) as unknown as {
          _core?: { coreService?: { triggerBinaryEvent?: (payload: string) => void } }
        }
        const coreService = terminal?._core?.coreService
        if (!coreService || typeof coreService.triggerBinaryEvent !== 'function') {
          return false
        }

        coreService.triggerBinaryEvent(data)
        return true
      },
      getSelection: nodeId => terminalHandles.get(nodeId)?.getSelection() ?? null,
      hasSelection: nodeId => terminalHandles.get(nodeId)?.hasSelection() ?? false,
      selectAll: nodeId => {
        const terminal = terminalHandles.get(nodeId)
        if (!terminal) {
          return false
        }

        terminal.selectAll()
        return true
      },
    }
  }

  return window.__opencoveTerminalSelectionTestApi
}

export function registerTerminalSelectionTestHandle(
  nodeId: string,
  terminal: TerminalSelectionHandle,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  getTerminalSelectionTestApi()
  terminalHandles.set(nodeId, terminal)

  return () => {
    terminalHandles.delete(nodeId)
  }
}
