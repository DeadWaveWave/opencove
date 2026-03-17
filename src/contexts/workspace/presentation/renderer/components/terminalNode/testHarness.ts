import type { Terminal } from '@xterm/xterm'

type TerminalSelectionHandle = Pick<
  Terminal,
  'clearSelection' | 'getSelection' | 'hasSelection' | 'selectAll'
>

type TerminalSelectionTestApi = {
  clearSelection: (nodeId: string) => boolean
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
