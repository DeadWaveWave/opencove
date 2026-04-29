import type { Terminal } from '@xterm/xterm'
import { peekCachedTerminalScreenState } from './screenStateCache'

type TerminalSelectionHandle = Pick<
  Terminal,
  | 'clearSelection'
  | 'getSelection'
  | 'hasSelection'
  | 'selectAll'
  | 'cols'
  | 'rows'
  | 'element'
  | 'scrollToBottom'
>

type TerminalRendererIntrospection = {
  _core?: {
    _renderService?: {
      dimensions?: {
        device?: {
          canvas?: { width?: number; height?: number }
        }
        css?: {
          canvas?: { width?: number; height?: number }
          cell?: { width?: number; height?: number }
        }
      }
    }
    _coreBrowserService?: {
      dpr?: unknown
    }
  }
  options?: { fontSize?: unknown; fontFamily?: unknown }
  __opencoveDprDebug?: {
    lastInputZoom?: unknown
    lastDecision?: unknown
    appliedDpr?: unknown
    hookLastZoom?: unknown
    hookAtBottom?: unknown
    hookViewportY?: unknown
    hookBaseY?: unknown
  }
  __opencoveXtermSessionInstanceId?: number
}

type TerminalSelectionTestApi = {
  clearSelection: (nodeId: string) => boolean
  getCellCenter: (nodeId: string, col: number, row: number) => { x: number; y: number } | null
  getFontOptions: (nodeId: string) => { fontSize: number | null; fontFamily: string | null } | null
  getRenderMetrics: (nodeId: string) => {
    effectiveDpr: number | null
    deviceCanvasWidth: number | null
    deviceCanvasHeight: number | null
    cssCanvasWidth: number | null
    cssCanvasHeight: number | null
    cssCellWidth: number | null
    cssCellHeight: number | null
    baseY: number | null
    viewportY: number | null
    isUserScrolling: boolean | null
    dprDecision: string | null
    hookAtBottom: boolean | null
    hookViewportY: number | null
    hookBaseY: number | null
    instanceId: number | null
  } | null
  getSize: (nodeId: string) => { cols: number; rows: number } | null
  getRegisteredNodeIds: () => string[]
  getRuntimeSessionId: (nodeId: string) => string | null
  getViewportY: (nodeId: string) => number | null
  getCachedScreenStateSummary: (nodeId: string) => {
    sessionId: string
    serializedLength: number
    serializedHasFrameToken: boolean
  } | null
  emitBinaryInput: (nodeId: string, data: string) => boolean
  getSelection: (nodeId: string) => string | null
  hasSelection: (nodeId: string) => boolean
  scrollToBottom: (nodeId: string) => boolean
  selectAll: (nodeId: string) => boolean
}

declare global {
  interface Window {
    __opencoveTerminalSelectionTestApi?: TerminalSelectionTestApi
  }
}

const terminalHandles = new Map<string, TerminalSelectionHandle>()
const terminalBinaryInputEmitters = new Map<string, (data: string) => boolean>()
const terminalRuntimeSessionIds = new Map<string, string>()

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
        const terminal = terminalHandles.get(nodeId) as unknown as TerminalRendererIntrospection
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
      getRenderMetrics: nodeId => {
        const terminal = terminalHandles.get(nodeId) as unknown as TerminalRendererIntrospection
        const dimensions = terminal?._core?._renderService?.dimensions
        if (!dimensions) {
          return null
        }

        const effectiveDpr = terminal?._core?._coreBrowserService?.dpr
        const deviceCanvas = dimensions.device?.canvas
        const cssCanvas = dimensions.css?.canvas
        const cssCell = dimensions.css?.cell
        const baseY = (terminal as unknown as { buffer?: { active?: { baseY?: unknown } } })?.buffer
          ?.active?.baseY
        const viewportY = (terminal as unknown as { buffer?: { active?: { viewportY?: unknown } } })
          ?.buffer?.active?.viewportY
        const isUserScrolling = (
          terminal as unknown as { _core?: { _bufferService?: { isUserScrolling?: unknown } } }
        )?._core?._bufferService?.isUserScrolling
        const dprDebug = terminal?.__opencoveDprDebug

        return {
          effectiveDpr:
            typeof effectiveDpr === 'number' && Number.isFinite(effectiveDpr) ? effectiveDpr : null,
          deviceCanvasWidth:
            typeof deviceCanvas?.width === 'number' && Number.isFinite(deviceCanvas.width)
              ? deviceCanvas.width
              : null,
          deviceCanvasHeight:
            typeof deviceCanvas?.height === 'number' && Number.isFinite(deviceCanvas.height)
              ? deviceCanvas.height
              : null,
          cssCanvasWidth:
            typeof cssCanvas?.width === 'number' && Number.isFinite(cssCanvas.width)
              ? cssCanvas.width
              : null,
          cssCanvasHeight:
            typeof cssCanvas?.height === 'number' && Number.isFinite(cssCanvas.height)
              ? cssCanvas.height
              : null,
          cssCellWidth:
            typeof cssCell?.width === 'number' && Number.isFinite(cssCell.width)
              ? cssCell.width
              : null,
          cssCellHeight:
            typeof cssCell?.height === 'number' && Number.isFinite(cssCell.height)
              ? cssCell.height
              : null,
          baseY: typeof baseY === 'number' && Number.isFinite(baseY) ? baseY : null,
          viewportY: typeof viewportY === 'number' && Number.isFinite(viewportY) ? viewportY : null,
          isUserScrolling: typeof isUserScrolling === 'boolean' ? isUserScrolling : null,
          dprDecision: typeof dprDebug?.lastDecision === 'string' ? dprDebug.lastDecision : null,
          hookAtBottom: typeof dprDebug?.hookAtBottom === 'boolean' ? dprDebug.hookAtBottom : null,
          hookViewportY:
            typeof dprDebug?.hookViewportY === 'number' && Number.isFinite(dprDebug.hookViewportY)
              ? dprDebug.hookViewportY
              : null,
          hookBaseY:
            typeof dprDebug?.hookBaseY === 'number' && Number.isFinite(dprDebug.hookBaseY)
              ? dprDebug.hookBaseY
              : null,
          instanceId:
            typeof terminal?.__opencoveXtermSessionInstanceId === 'number' &&
            Number.isFinite(terminal.__opencoveXtermSessionInstanceId)
              ? terminal.__opencoveXtermSessionInstanceId
              : null,
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
      getRegisteredNodeIds: () => [...terminalHandles.keys()],
      getRuntimeSessionId: nodeId => terminalRuntimeSessionIds.get(nodeId) ?? null,
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
          serializedHasFrameToken: cached.serialized.includes('FRAME_29999_TOKEN'),
        }
      },
      emitBinaryInput: (nodeId, data) => {
        const testEmitter = terminalBinaryInputEmitters.get(nodeId)
        if (testEmitter) {
          return testEmitter(data)
        }

        const terminal = terminalHandles.get(nodeId) as unknown as {
          element?: HTMLElement | null
          _core?: { coreService?: { triggerBinaryEvent?: (payload: string) => void } }
        }
        const coreService = terminal?._core?.coreService
        if (!coreService || typeof coreService.triggerBinaryEvent !== 'function') {
          return false
        }

        const interactionTarget = terminal.element?.parentElement ?? terminal.element ?? null
        interactionTarget?.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
          }),
        )
        coreService.triggerBinaryEvent(data)
        return true
      },
      getSelection: nodeId => terminalHandles.get(nodeId)?.getSelection() ?? null,
      hasSelection: nodeId => terminalHandles.get(nodeId)?.hasSelection() ?? false,
      scrollToBottom: nodeId => {
        const terminal = terminalHandles.get(nodeId)
        if (!terminal) {
          return false
        }

        terminal.scrollToBottom()
        return true
      },
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

export function registerTerminalBinaryInputTestHandle(
  nodeId: string,
  emitBinaryInput: (data: string) => boolean,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  getTerminalSelectionTestApi()
  terminalBinaryInputEmitters.set(nodeId, emitBinaryInput)

  return () => {
    if (terminalBinaryInputEmitters.get(nodeId) === emitBinaryInput) {
      terminalBinaryInputEmitters.delete(nodeId)
    }
  }
}

export function registerTerminalRuntimeSessionTestHandle(
  nodeId: string,
  sessionId: string,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  getTerminalSelectionTestApi()
  terminalRuntimeSessionIds.set(nodeId, sessionId)

  return () => {
    if (terminalRuntimeSessionIds.get(nodeId) === sessionId) {
      terminalRuntimeSessionIds.delete(nodeId)
    }
  }
}

export function registerTerminalRuntimeTestHandles({
  enabled,
  nodeId,
  sessionId,
  emitBinaryInput,
}: {
  enabled: boolean
  nodeId: string
  sessionId: string
  emitBinaryInput: (data: string) => boolean
}): () => void {
  if (!enabled) {
    return () => undefined
  }

  const disposeBinaryInput = registerTerminalBinaryInputTestHandle(nodeId, emitBinaryInput)
  const disposeRuntimeSession = registerTerminalRuntimeSessionTestHandle(nodeId, sessionId)

  return () => {
    disposeBinaryInput()
    disposeRuntimeSession()
  }
}
