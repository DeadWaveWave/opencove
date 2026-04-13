import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

async function resolveElectronBinaryPath(): Promise<string> {
  const electronImport = await import('electron')
  const candidate =
    (electronImport as unknown as { default?: unknown }).default ??
    (electronImport as unknown as { 'module.exports'?: unknown })['module.exports']

  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new Error('[e2e] Unable to resolve Electron binary path for starting the remote worker.')
  }

  return candidate
}

export async function reserveLoopbackPort(): Promise<number> {
  await new Promise(resolve => setTimeout(resolve, 0))
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('[e2e] Failed to reserve an ephemeral port.')))
        return
      }

      const port = address.port
      server.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve(port)
      })
    })
  })
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

export async function pollFor<T>(
  fn: () => Promise<T | null>,
  options?: { timeoutMs?: number; intervalMs?: number; label?: string },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 15_000
  const intervalMs = options?.intervalMs ?? 100
  const label = options?.label ?? 'value'
  const startedAt = Date.now()

  const poll = async (): Promise<T> => {
    const value = await fn().catch(() => null)
    if (value !== null) {
      return value
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`[e2e] Timed out waiting for ${label}.`)
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
    return await poll()
  }

  return await poll()
}

async function waitForControlSurfaceReady(connection: {
  hostname: string
  port: number
  token: string
}): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(
            `http://${connection.hostname}:${String(connection.port)}/invoke`,
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${connection.token}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({ kind: 'query', id: 'system.ping', payload: null }),
            },
          )
          const raw = await response.text()
          const parsed = raw.trim().length > 0 ? (JSON.parse(raw) as unknown) : null
          return (
            !!parsed &&
            typeof parsed === 'object' &&
            (parsed as Record<string, unknown>).__opencoveControlEnvelope === true &&
            (parsed as Record<string, unknown>).ok === true
          )
        } catch {
          return false
        }
      },
      { timeout: 15_000 },
    )
    .toBe(true)
}

export interface RemoteWorkerHandle {
  child: ChildProcessWithoutNullStreams
  logs: () => string
}

export async function startRemoteWorker(options: {
  hostname: string
  port: number
  token: string
  userDataDir: string
  homeDir: string
  approveRoot: string
  agentSessionScenario?: string
  env?: Record<string, string>
}): Promise<RemoteWorkerHandle> {
  const electronBinary = await resolveElectronBinaryPath()
  const workerPath = path.resolve(__dirname, '../../out/main/worker.js')
  const stubScriptPath = path.resolve(__dirname, '../../scripts/test-agent-session-stub.mjs')

  const stdout: string[] = []
  const stderr: string[] = []

  const shouldDisableSandbox = process.platform === 'linux' && isTruthyEnv(process.env['CI'])

  const child = spawn(
    electronBinary,
    [
      workerPath,
      '--hostname',
      options.hostname,
      '--port',
      String(options.port),
      '--token',
      options.token,
      '--user-data',
      options.userDataDir,
      '--approve-root',
      options.approveRoot,
    ],
    {
      env: {
        ...process.env,
        ...(options.env ?? {}),
        NODE_ENV: 'test',
        ELECTRON_RUN_AS_NODE: '1',
        ...(shouldDisableSandbox ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
        HOME: options.homeDir,
        USERPROFILE: options.homeDir,
        OPENCOVE_TEST_AGENT_STUB_SCRIPT: stubScriptPath,
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: options.agentSessionScenario ?? 'codex-standby-only',
      },
      stdio: 'pipe',
      windowsHide: true,
    },
  )

  child.stdout.on('data', chunk => {
    stdout.push(chunk.toString())
  })
  child.stderr.on('data', chunk => {
    stderr.push(chunk.toString())
  })

  const logs = () => {
    const merged = [...stdout, ...stderr].join('')
    return merged.trim().length > 0 ? merged : '[no remote worker logs captured]'
  }

  await waitForControlSurfaceReady({
    hostname: options.hostname,
    port: options.port,
    token: options.token,
  })

  return { child, logs }
}

export async function stopRemoteWorker(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return
  }

  child.kill()

  await Promise.race([
    new Promise<void>(resolve => {
      child.once('exit', () => resolve())
      child.once('close', () => resolve())
    }),
    new Promise(resolve => setTimeout(resolve, 2_500)),
  ]).catch(() => undefined)

  if (child.exitCode === null) {
    child.kill('SIGKILL')
  }
}

export function explorerEntry(window: Page, spaceId: string, uri: string): Locator {
  return window.locator(
    `[data-testid="workspace-space-explorer-entry-${spaceId}-${encodeURIComponent(uri)}"]`,
  )
}

export async function openSettings(window: Page): Promise<void> {
  const settingsButton = window.locator('[data-testid="app-header-settings"]')
  await expect(settingsButton).toBeVisible()
  await settingsButton.click({ noWaitAfter: true })
  await expect(window.locator('.settings-panel')).toBeVisible()
}

export async function closeSettings(window: Page): Promise<void> {
  const closeButton = window.locator('.settings-panel__close')
  await expect(closeButton).toBeVisible()
  await closeButton.click({ noWaitAfter: true })
  await expect(window.locator('.settings-panel')).toHaveCount(0)
}

export async function switchSettingsPage(window: Page, pageId: string): Promise<void> {
  const nav = window.locator(`[data-testid="settings-section-nav-${pageId}"]`)
  await expect(nav).toBeVisible()
  await nav.click({ noWaitAfter: true })
}
