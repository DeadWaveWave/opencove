import { utilityProcess } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

type PtyHostReadyMessage = {
  type: 'ready'
  protocolVersion: 1
}

type PtyHostResponseMessage =
  | {
      type: 'response'
      requestId: string
      ok: true
      result: { sessionId: string }
    }
  | {
      type: 'response'
      requestId: string
      ok: false
      error: { name?: string; message: string }
    }

type PtyHostDataMessage = {
  type: 'data'
  sessionId: string
  data: string
}

type PtyHostExitMessage = {
  type: 'exit'
  sessionId: string
  exitCode: number
}

type PtyHostMessage =
  | PtyHostReadyMessage
  | PtyHostResponseMessage
  | PtyHostDataMessage
  | PtyHostExitMessage

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise
      .then(value => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(error => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

export async function runPtyHostUtilityProcessPoc(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !isTruthyEnv(process.env['OPENCOVE_PTY_HOST_POC'])) {
    return
  }

  const modulePathCandidates = [join(__dirname, 'ptyHost.js'), join(__dirname, '..', 'ptyHost.js')]
  const modulePath = modulePathCandidates.find(candidate => existsSync(candidate))
  if (!modulePath) {
    throw new Error(`[opencove] pty-host PoC missing entry: ${modulePathCandidates.join(', ')}`)
  }
  process.stderr.write(`[opencove] pty-host PoC launching: ${modulePath}\n`)

  const child = utilityProcess.fork(modulePath, [], {
    stdio: 'pipe',
    serviceName: 'OpenCove PTY Host (PoC)',
  })

  child.stdout?.on('data', chunk => {
    process.stderr.write(`[pty-host stdout] ${String(chunk)}`)
  })

  child.stderr?.on('data', chunk => {
    process.stderr.write(`[pty-host stderr] ${String(chunk)}`)
  })

  let onReady: (() => void) | null = null
  const readyPromise = new Promise<void>(resolve => {
    onReady = resolve
  })

  const pendingResponseResolvers = new Map<
    string,
    (message: Extract<PtyHostMessage, { type: 'response' }>) => void
  >()

  let observedOutput = ''
  let spawnedSessionId: string | null = null

  child.on('message', rawMessage => {
    const message = rawMessage as PtyHostMessage

    if (message.type === 'ready') {
      onReady?.()
      onReady = null
      return
    }

    if (message.type === 'response') {
      pendingResponseResolvers.get(message.requestId)?.(message)
      pendingResponseResolvers.delete(message.requestId)
      return
    }

    if (message.type === 'data') {
      if (message.sessionId === spawnedSessionId) {
        observedOutput += message.data
      }
      return
    }

    if (message.type === 'exit') {
      process.stderr.write(
        `[opencove] pty-host PoC session exited: ${message.sessionId} code=${message.exitCode}\n`,
      )
      return
    }
  })

  await withTimeout(readyPromise, 5_000, '[opencove] pty-host PoC timed out waiting for ready')

  const requestId = crypto.randomUUID()
  const spawnResponsePromise = new Promise<Extract<PtyHostMessage, { type: 'response' }>>(
    resolve => {
      pendingResponseResolvers.set(requestId, resolve)
    },
  )

  child.postMessage({
    type: 'spawn',
    requestId,
    command: process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh',
    args:
      process.platform === 'win32'
        ? ['-NoProfile', '-Command', 'echo POC_OK']
        : ['-lc', 'echo POC_OK'],
    cwd: process.cwd(),
    env: { ...process.env },
    cols: 80,
    rows: 24,
  })

  const spawnResponse = await withTimeout(
    spawnResponsePromise,
    10_000,
    '[opencove] pty-host PoC timed out waiting for spawn response',
  )

  if (!spawnResponse.ok) {
    throw new Error(
      `[opencove] pty-host PoC spawn failed: ${spawnResponse.error.name ?? 'Error'}: ${spawnResponse.error.message}`,
    )
  }

  spawnedSessionId = spawnResponse.result.sessionId
  process.stderr.write(`[opencove] pty-host PoC spawned session: ${spawnedSessionId}\n`)

  await withTimeout(
    new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (observedOutput.includes('POC_OK')) {
          clearInterval(interval)
          resolve()
        }
      }, 25)
    }),
    10_000,
    '[opencove] pty-host PoC timed out waiting for output',
  )

  process.stderr.write('[opencove] pty-host PoC observed output OK\n')

  const exitPromise = new Promise<number>(resolve => {
    child.once('exit', code => {
      resolve(code)
    })
  })

  process.stderr.write('[opencove] pty-host PoC triggering crash\n')
  child.postMessage({ type: 'crash' })

  const exitCode = await withTimeout(
    exitPromise,
    10_000,
    '[opencove] pty-host PoC timed out waiting for host exit',
  )

  process.stderr.write(`[opencove] pty-host PoC host exited (main still alive): code=${exitCode}\n`)
}
