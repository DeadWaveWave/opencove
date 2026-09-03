import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'

export type TerminalDisplayRendererObservationKind = 'dom' | 'webgl'

export type TerminalDisplayMeasurementHandle = {
  terminal: Terminal
  fitAddon: FitAddon
  getRendererKind: () => TerminalDisplayRendererObservationKind
}

type RegisteredHandle = TerminalDisplayMeasurementHandle & { token: symbol }

export const TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED =
  'opencove:terminal-display-measurement-handles-changed'

const handles = new Map<string, RegisteredHandle>()

export function notifyTerminalDisplayMeasurementHandlesChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(TERMINAL_DISPLAY_MEASUREMENT_HANDLES_CHANGED))
  }
}

export function registerTerminalDisplayMeasurementHandle(
  nodeId: string,
  handle: TerminalDisplayMeasurementHandle,
): () => void {
  const token = Symbol(nodeId)
  handles.set(nodeId, { ...handle, token })
  notifyTerminalDisplayMeasurementHandlesChanged()

  return () => {
    if (handles.get(nodeId)?.token !== token) {
      return
    }
    handles.delete(nodeId)
    notifyTerminalDisplayMeasurementHandlesChanged()
  }
}

export function listTerminalDisplayMeasurementHandles(): TerminalDisplayMeasurementHandle[] {
  return [...handles.values()].map(({ terminal, fitAddon, getRendererKind }) => ({
    terminal,
    fitAddon,
    getRendererKind,
  }))
}
