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

export async function startWorker(options: {
  userDataDir: string
  env?: Record<string, string | undefined>
}): Promise<{
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
    '0',
    '--user-data',
    options.userDataDir,
  ]

  const child = spawn(String(electronPath), args, {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OPENCOVE_USER_DATA_DIR: options.userDataDir,
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const info = await new Promise<WorkerConnectionInfo>((resolvePromise, rejectPromise) => {
    const rl = createInterface({ input: child.stdout })

    const timeout = setTimeout(() => {
      rl.close()
      rejectPromise(new Error('Timed out waiting for worker ready payload'))
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

    child.once('exit', code => {
      clearTimeout(timeout)
      rl.close()
      rejectPromise(new Error(`Worker exited before ready (code=${code ?? 1})`))
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
