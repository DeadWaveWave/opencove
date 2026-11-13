import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import electronPath from 'electron'
import { expect } from '@playwright/test'

type WorkerConnectionInfo = {
  hostname: string
  port: number
  token: string
}

const WORKER_READY_TIMEOUT_MS = 7_500
const WORKER_STOP_TIMEOUT_MS = 7_500
const WORKER_STDERR_TAIL_CHARS = 4_000

function resolveWorkerScriptPath(): string {
  return path.resolve(__dirname, '../../out/main/worker.js')
}

function normalizeWorkerReadyPayload(value: unknown): WorkerConnectionInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const hostname = typeof record.hostname === 'string' ? record.hostname : null
  const port = typeof record.port === 'number' ? record.port : null
  const token = typeof record.token === 'string' ? record.token : null

  if (!hostname || !port || !token) {
    return null
  }

  return { hostname, port, token }
}

type StartWorkerOptions = {
  userDataDir: string
  port?: number
  token?: string
  env?: Record<string, string | undefined>
}

const FIXED_PORT_START_ATTEMPTS = 5
const FIXED_PORT_RETRY_DELAY_MS = 500

/**
 * Starts a Worker. A restart that pins the previous Worker's port can lose that port to another
 * process on a busy machine, because it came from the ephemeral range; only that case is retried.
 */
export async function startWorker(
  options: StartWorkerOptions,
  attempt = 1,
): Promise<{
  child: ChildProcessWithoutNullStreams
}> {
  try {
    return await startWorkerOnce(options)
  } catch (error) {
    const fixedPort = typeof options.port === 'number' && options.port > 0
    const portTaken = error instanceof Error && error.message.includes('EADDRINUSE')
    if (!fixedPort || !portTaken || attempt >= FIXED_PORT_START_ATTEMPTS) {
      throw error
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, FIXED_PORT_RETRY_DELAY_MS))
    return await startWorker(options, attempt + 1)
  }
}

async function startWorkerOnce(options: StartWorkerOptions): Promise<{
  child: ChildProcessWithoutNullStreams
}> {
  const workerScriptPath = resolveWorkerScriptPath()
  const args = [
    workerScriptPath,
    '--parent-pid',
    String(process.pid),
    '--hostname',
    '127.0.0.1',
    '--port',
    String(options.port ?? 0),
    ...(options.token ? ['--token', options.token] : []),
    '--user-data',
    options.userDataDir,
  ]

  const child = spawn(String(electronPath), args, {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OPENCOVE_USER_DATA_DIR: options.userDataDir,
      OPENCOVE_TEST_NODE_EXECUTABLE: process.execPath,
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  // Keep the Worker's last stderr so a startup failure says why instead of only its exit code.
  let stderrTail = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-WORKER_STDERR_TAIL_CHARS)
  })

  const info = await new Promise<WorkerConnectionInfo>((resolvePromise, rejectPromise) => {
    const rl = createInterface({ input: child.stdout })

    const timeout = setTimeout(() => {
      rl.close()
      const detail = stderrTail.trim()
      rejectPromise(
        new Error(
          `Timed out waiting for worker ready payload${detail ? `\nWorker stderr:\n${detail}` : ''}`,
        ),
      )
    }, WORKER_READY_TIMEOUT_MS)

    rl.on('line', line => {
      try {
        const parsed = JSON.parse(line) as unknown
        const normalized = normalizeWorkerReadyPayload(parsed)
        if (!normalized) {
          return
        }

        clearTimeout(timeout)
        rl.close()
        resolvePromise(normalized)
      } catch {
        // ignore non-JSON output
      }
    })

    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      rl.close()
      const reason = signal ? `signal=${signal}` : `code=${code ?? 1}`
      const detail = stderrTail.trim()
      rejectPromise(
        new Error(
          `Worker exited before ready (${reason})${detail ? `\nWorker stderr:\n${detail}` : ''}`,
        ),
      )
    })
  })

  // Sanity: keep the worker alive for the duration of the test.
  expect(info.hostname).toBeTruthy()
  expect(info.port).toBeGreaterThan(0)
  expect(info.token).toBeTruthy()

  return { child }
}

export async function stopWorker(child: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  await new Promise<void>(resolvePromise => {
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        child.kill()
      }
    }, WORKER_STOP_TIMEOUT_MS)

    child.once('exit', () => {
      clearTimeout(timeout)
      resolvePromise()
    })

    try {
      child.kill('SIGTERM')
    } catch {
      child.kill()
    }
  })
}

export function resolveTestAgentStubScriptPath(): string {
  return path.resolve(__dirname, '../../scripts/test-agent-session-stub.mjs')
}
