import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type {
  PluginBackend,
  PluginBackendPort,
  PluginSnapshot,
} from '../application/PluginRuntimePorts'

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class NodePluginBackend implements PluginBackendPort {
  constructor(
    private readonly hostEntry: string,
    private readonly timeout = 15_000,
  ) {}

  async start(
    snapshot: PluginSnapshot,
    options: Parameters<PluginBackendPort['start']>[1],
  ): Promise<PluginBackend> {
    if (!snapshot.package.main) {
      throw new Error('Plugin has no backend entry.')
    }
    const child = fork(this.hostEntry, [], {
      cwd: snapshot.directory,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      execArgv: [],
    })
    const pending = new Map<string, Pending>()
    let closed = false
    let ready = false
    let unavailable: Error | null = null
    let disposePromise: Promise<void> | null = null
    let readyResolve!: () => void
    let readyReject!: (error: Error) => void
    const startup = new Promise<void>((accept, reject) => {
      readyResolve = accept
      readyReject = reject
    })
    const startupTimer = setTimeout(
      () => fail(new Error('Plugin activation timed out.')),
      this.timeout,
    )
    const fail = (error: Error): void => {
      if (unavailable) {
        return
      }
      unavailable = error
      clearTimeout(startupTimer)
      readyReject(error)
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(error)
      }
      pending.clear()
      if (!closed) {
        options.unavailable(error.message)
      }
    }
    const output = (prefix: string, chunk: Buffer): void =>
      options.log(`${prefix}${chunk.toString('utf8').slice(0, 4000)}`)
    child.stdout?.on('data', (chunk: Buffer) => output('', chunk))
    child.stderr?.on('data', (chunk: Buffer) => output('stderr: ', chunk))
    child.once('error', error => fail(error))
    child.once('exit', (code, signal) =>
      fail(new Error(`Plugin process exited (${signal ?? code ?? 'unknown'}).`)),
    )
    child.on('message', (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return
      }
      const message = raw as Record<string, unknown>
      if (message.type === 'log' && typeof message.message === 'string') {
        options.log(message.message.slice(0, 4000))
      }
      if (message.type === 'startup-error') {
        fail(new Error(String(message.error)))
      }
      if (message.type === 'ready' && message.protocol === 1 && !closed && !unavailable) {
        ready = true
        clearTimeout(startupTimer)
        readyResolve()
      }
      if (message.type !== 'response' || typeof message.requestId !== 'string') {
        return
      }
      const request = pending.get(message.requestId)
      if (!request) {
        return
      }
      pending.delete(message.requestId)
      clearTimeout(request.timer)
      if (message.ok === true) {
        request.resolve(message.value)
      } else {
        request.reject(
          new Error(typeof message.error === 'string' ? message.error : 'Plugin request failed.'),
        )
      }
    })
    const dispose = (): Promise<void> => {
      if (disposePromise) {
        return disposePromise
      }
      closed = true
      fail(new Error('Plugin process was stopped.'))
      disposePromise = new Promise<void>(accept => {
        if (child.exitCode !== null || child.signalCode !== null) {
          accept()
          return
        }
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          accept()
        }, 2000)
        child.once('exit', () => {
          clearTimeout(timer)
          accept()
        })
        if (child.connected) {
          child.send({ type: 'shutdown' }, error => {
            if (error) {
              child.kill('SIGTERM')
            }
          })
        } else {
          child.kill('SIGTERM')
        }
      })
      return disposePromise
    }
    child.send(
      {
        type: 'initialize',
        protocol: 1,
        entry: resolve(snapshot.directory, snapshot.package.main),
        pluginId: snapshot.package.id,
        dataDirectory: options.dataDirectory,
      },
      error => {
        if (error) {
          fail(error)
        }
      },
    )
    try {
      await startup
    } catch (error) {
      await dispose()
      throw error
    }
    return {
      invoke: async (method, params, context) => {
        if (closed || unavailable || !ready) {
          throw unavailable ?? new Error('Plugin process is unavailable.')
        }
        if (pending.size >= 128) {
          throw new Error('Too many pending plugin requests.')
        }
        const requestId = randomUUID()
        return await new Promise<unknown>((accept, reject) => {
          const timer = setTimeout(() => {
            pending.delete(requestId)
            reject(new Error('Plugin request timed out.'))
          }, 30_000)
          pending.set(requestId, { resolve: accept, reject, timer })
          child.send({ type: 'invoke', requestId, method, params, context }, error => {
            if (!error) {
              return
            }
            pending.delete(requestId)
            clearTimeout(timer)
            reject(error)
          })
        })
      },
      dispose,
    }
  }
}
