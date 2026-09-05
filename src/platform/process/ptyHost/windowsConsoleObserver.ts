import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { abortable } from './abortableOperation'
import { isWindowsConsoleResponse, type WindowsConsoleGeometry } from './windowsConsoleProtocol'
import type { WindowsConsoleObserver } from './windowsPtyResizeOwner'

type PendingRead = {
  resolve: (geometry: WindowsConsoleGeometry) => void
  reject: (error: Error) => void
}

type ObserverProcess = {
  child: ChildProcess
  ready: Promise<void>
  resolveReady: () => void
  rejectReady: (error: Error) => void
  startupTimer: ReturnType<typeof setTimeout>
  pending: Map<number, PendingRead>
}

function spawnObserver(): ChildProcess {
  return spawn(process.execPath, [join(__dirname, 'windowsConsoleObserver.js')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
}

/** One lazy observer per Host. Queries share a process; replies cannot cross process generations. */
export class WindowsConsoleGeometryObserver implements WindowsConsoleObserver {
  private current: ObserverProcess | null = null
  private disposed = false
  private nextRequestId = 0

  public constructor(private readonly start: () => ChildProcess = spawnObserver) {}

  public async ensureReady(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.disposed) {
      throw new Error('[pty-host] Console observer disposed')
    }
    const current = this.current ?? this.launch()
    await abortable(current.ready, signal)
    signal.throwIfAborted()
    if (this.current !== current) {
      throw new Error('[pty-host] Console observer replaced')
    }
  }

  public async read(pid: number, signal: AbortSignal): Promise<WindowsConsoleGeometry> {
    await this.ensureReady(signal)
    signal.throwIfAborted()
    const current = this.current!
    const requestId = ++this.nextRequestId
    const response = new Promise<WindowsConsoleGeometry>((resolve, reject) => {
      current.pending.set(requestId, { resolve, reject })
      try {
        current.child.send({ type: 'read', requestId, pid }, error => {
          if (error) {
            this.retire(current, error)
          }
        })
      } catch (error) {
        reject(error)
      }
    })
    const timer = setTimeout(() => {
      this.retire(current, new Error('[pty-host] Console observer query timed out'))
    }, 500)
    try {
      return await abortable(response, signal)
    } catch (error) {
      // A synchronous send error also invalidates this transport. Session cancellation does not.
      if (!signal.aborted) {
        this.retire(current, error instanceof Error ? error : new Error(String(error)))
      }
      throw error
    } finally {
      clearTimeout(timer)
      current.pending.delete(requestId)
    }
  }

  public dispose(): void {
    this.disposed = true
    if (this.current) {
      this.retire(this.current, new Error('[pty-host] Console observer disposed'))
    }
  }

  private launch(): ObserverProcess {
    const child = this.start()
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const current: ObserverProcess = {
      child,
      ready,
      resolveReady,
      rejectReady,
      pending: new Map(),
      startupTimer: setTimeout(() => {
        this.retire(current, new Error('[pty-host] Console observer startup timed out'))
      }, 1_500),
    }
    this.current = current
    child.on('message', message => {
      if (this.current !== current) {
        return
      }
      if (!isWindowsConsoleResponse(message)) {
        this.retire(current, new Error('[pty-host] Invalid Console observer response'))
        return
      }
      if (message.type === 'unavailable') {
        this.retire(current, new Error(message.error))
      } else if (message.type === 'ready') {
        clearTimeout(current.startupTimer)
        current.resolveReady()
      } else {
        const pending = current.pending.get(message.requestId)
        current.pending.delete(message.requestId)
        if (message.type === 'geometry') {
          pending?.resolve(message.geometry)
        } else {
          pending?.reject(new Error(message.error))
        }
      }
    })
    child.once('error', error => this.retire(current, error))
    child.once('exit', code => {
      this.retire(current, new Error(`[pty-host] Console observer exited (${code})`))
    })
    return current
  }

  private retire(current: ObserverProcess, error: Error): void {
    if (this.current !== current) {
      return
    }
    this.current = null
    clearTimeout(current.startupTimer)
    current.rejectReady(error)
    for (const pending of current.pending.values()) {
      pending.reject(error)
    }
    current.pending.clear()
    current.child.removeAllListeners('message')
    if (current.child.connected) {
      current.child.disconnect()
    }
    current.child.kill()
  }
}
