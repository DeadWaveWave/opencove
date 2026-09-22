import type { IDisposable, IMarker, Terminal } from '@xterm/xterm'
import {
  hasTerminalLinkControlCharacters,
  prepareTerminalLinkPath,
} from '@contexts/terminal/domain/links/terminalLinkPath'

export interface ObservedTerminalCwd {
  cwd: string
  cwdSource: 'observed'
}

export interface TerminalCwdObservation {
  /** Buffer row is 1-based, matching the public link provider API. */
  getContextAt: (bufferRow: number) => ObservedTerminalCwd | undefined
  /** Call before replacing/replaying a presentation snapshot. Never persists cwd. */
  reset: () => void
  suspend: () => IDisposable
  dispose: () => void
}

const observationByTerminal = new WeakMap<Terminal, TerminalCwdObservation>()

export function resetTerminalCwdObservation(terminal: Terminal): void {
  observationByTerminal.get(terminal)?.reset()
}

export function suspendTerminalCwdObservation(terminal: Terminal): IDisposable {
  return observationByTerminal.get(terminal)?.suspend() ?? { dispose() {} }
}

interface CwdMarker {
  marker: IMarker
  cwd: string
  startsMidRow: boolean
}

export interface TerminalCwdSourceOptions {
  /** Owner-provided identity for the source session, endpoint and mount. */
  sourceKey?: string
  platform?: 'posix' | 'windows'
  hostname?: string
}

function parseSourceCwd(data: string, source: TerminalCwdSourceOptions): string | undefined {
  if (data.length > 8192 || hasTerminalLinkControlCharacters(data)) {
    return undefined
  }
  try {
    const uri = new URL(data)
    if (uri.protocol !== 'file:') {
      return undefined
    }
    const host = uri.hostname.toLowerCase()
    if (host && host !== 'localhost' && host !== source.hostname?.toLowerCase()) {
      return undefined
    }
    // OSC 7's authority identifies the emitting host; it is not an UNC file server.
    uri.hostname = ''
    const result = prepareTerminalLinkPath(uri.toString(), {
      cwdSource: 'unknown',
      platform: source.platform,
    })
    return result.status === 'prepared' ? result.path : undefined
  } catch {
    return undefined
  }
}

/** Runtime-only provenance for output whose OSC 7 cwd was observed in this xterm instance. */
export function installTerminalCwdObservation(
  terminal: Terminal,
  source: TerminalCwdSourceOptions | (() => TerminalCwdSourceOptions) = {},
): TerminalCwdObservation {
  observationByTerminal.get(terminal)?.dispose()
  let disposed = false
  let suspensions = 0
  let sourceIdentity: string | undefined
  let markers: CwdMarker[] = []
  const disposables: IDisposable[] = []
  const reset = () => {
    for (const entry of markers) {
      entry.marker.dispose()
    }
    markers = []
  }
  const prune = () => {
    markers = markers.filter(entry => !entry.marker.isDisposed)
  }
  const readSource = () => {
    const context = typeof source === 'function' ? source() : source
    const identity = JSON.stringify([
      context.sourceKey ?? null,
      context.platform ?? null,
      context.hostname?.toLowerCase() ?? null,
    ])
    if (sourceIdentity !== identity) {
      reset()
      sourceIdentity = identity
    }
    return context
  }
  const observe = (data: string) => {
    if (disposed || suspensions > 0 || terminal.buffer.active.type !== 'normal') {
      return false
    }
    const cwd = parseSourceCwd(data, readSource())
    if (!cwd) {
      // Foreign/invalid observations invalidate the previous guess, e.g. an ssh child shell.
      reset()
      return false
    }
    prune()
    const marker = terminal.registerMarker(0)
    if (!marker) {
      return false
    }
    const last = markers.at(-1)
    if (last && last.marker.line > marker.line) {
      reset()
    }
    markers.push({ marker, cwd, startsMidRow: terminal.buffer.active.cursorX > 0 })
    // Bounded by recent cwd transitions, independently of scrollback length.
    while (markers.length > 128) {
      markers.shift()?.marker.dispose()
    }
    return false
  }
  disposables.push(
    terminal.parser.registerOscHandler(7, observe),
    terminal.parser.registerEscHandler({ final: 'c' }, () => {
      reset()
      return false
    }),
    terminal.parser.registerCsiHandler({ final: 'J' }, () => {
      reset()
      return false
    }),
    terminal.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
      reset()
      return false
    }),
    terminal.onResize(reset),
    terminal.buffer.onBufferChange(reset),
  )
  const observation: TerminalCwdObservation = {
    getContextAt(bufferRow) {
      readSource()
      if (
        disposed ||
        suspensions > 0 ||
        !Number.isSafeInteger(bufferRow) ||
        bufferRow < 1 ||
        terminal.buffer.active.type !== 'normal'
      ) {
        return undefined
      }
      prune()
      const row = bufferRow - 1
      for (let index = markers.length - 1; index >= 0; index--) {
        const entry = markers[index]
        if (entry.marker.line > row) {
          continue
        }
        if (entry.marker.line === row && entry.startsMidRow) {
          return undefined
        }
        return { cwd: entry.cwd, cwdSource: 'observed' }
      }
      return undefined
    },
    reset,
    suspend() {
      reset()
      suspensions++
      let released = false
      return {
        dispose() {
          if (released) {
            return
          }
          released = true
          suspensions--
        },
      }
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      observationByTerminal.delete(terminal)
      reset()
      for (const disposable of disposables) {
        disposable.dispose()
      }
    },
  }
  observationByTerminal.set(terminal, observation)
  return observation
}
