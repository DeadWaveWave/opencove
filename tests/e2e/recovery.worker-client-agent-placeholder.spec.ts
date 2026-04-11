import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import electronPath from 'electron'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

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

async function startWorker(options: { userDataDir: string }): Promise<{
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

async function stopWorker(child: ChildProcessWithoutNullStreams | null): Promise<void> {
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

async function writeAgentPlaceholder(window: Page, nodeId: string, scrollback: string) {
  const result = await window.evaluate(async payload => {
    return await window.opencoveApi.persistence.writeAgentNodePlaceholderScrollback(payload)
  }, { nodeId, scrollback })

  expect(result.ok).toBe(true)
}

test.describe('Recovery - Worker client placeholder persistence', () => {
  test('persists and restores agent placeholder scrollback via worker control-surface', async () => {
    const userDataDir = await createTestUserDataDir()
    let workerChild: ChildProcessWithoutNullStreams | null = null

    try {
      const worker = await startWorker({ userDataDir })
      workerChild = worker.child

      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_WORKER_CLIENT: '1',
        },
      })

      try {
        await clearAndSeedWorkspace(window, [
          {
            id: 'agent-one',
            title: 'agent-one',
            position: { x: 120, y: 140 },
            width: 520,
            height: 320,
            kind: 'agent',
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- seed payload is intentionally loose
            // @ts-ignore
            sessionId: 'dummy-session-active',
          },
        ])

        await writeAgentPlaceholder(window, 'agent-one', 'WORKER_PLACEHOLDER\\r\\n')
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_WORKER_CLIENT: '1',
        },
      })

      try {
        await expect(restartedWindow.locator('.workspace-item')).toHaveCount(1)
        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(1)
        await expect(restartedWindow.locator('.terminal-node').first()).toContainText(
          'WORKER_PLACEHOLDER',
        )
      } finally {
        await restartedApp.close()
      }
    } finally {
      await stopWorker(workerChild)
      await removePathWithRetry(userDataDir)
    }
  })
})
