import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import { createFakeManagedSshInstallDir } from './fake-managed-ssh'
import {
  openSettings,
  pollFor,
  reserveLoopbackPort,
  startRemoteWorker,
  stopRemoteWorker,
  switchSettingsPage,
  type RemoteWorkerHandle,
} from './m6.endpoints-mounts.integration.helpers'
import { launchApp, removePathWithRetry } from './workspace-canvas.helpers'

interface ProgressFixture {
  window: Page
  endpointId: string
  remoteHome: string
  card: Locator
  release: (phase: string) => Promise<void>
  waitForPhase: (phase: string) => Promise<void>
  assertNoTunnel: () => Promise<void>
  startWorker: () => Promise<void>
}

export async function withManagedSshProgress(
  settings: { uiTheme: 'light' | 'dark'; language: 'en' | 'zh-CN' },
  run: (fixture: ProgressFixture) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'opencove-ssh-progress-'))
  const gates = path.join(root, 'gates')
  const appUserData = path.join(root, 'app')
  const remoteHome = path.join(root, 'home')
  await mkdir(gates)
  await mkdir(path.join(remoteHome, 'project'), { recursive: true })
  const fakeSsh = await createFakeManagedSshInstallDir()
  const remotePort = await reserveLoopbackPort()
  let worker: RemoteWorkerHandle | null = null
  let app: Awaited<ReturnType<typeof launchApp>> | null = null
  try {
    app = await launchApp({
      userDataDir: appUserData,
      env: {
        PATH: `${fakeSsh}${path.delimiter}${process.env.PATH ?? ''}`,
        OPENCOVE_FAKE_SSH_GATE_DIR: gates,
      },
    })
    const { window } = app
    const seeded = await window.evaluate(
      async preferences =>
        await window.opencoveApi.persistence.writeWorkspaceStateRaw({
          raw: JSON.stringify({
            formatVersion: 1,
            activeWorkspaceId: null,
            workspaces: [],
            settings: { ...preferences, experimentalRemoteWorkersEnabled: true },
          }),
        }),
      settings,
    )
    expect(seeded.ok).toBe(true)
    const endpointId = await window.evaluate(async port => {
      const result = await window.opencoveApi.controlSurface.invoke<{
        endpoint: { endpointId: string }
      }>({
        kind: 'command',
        id: 'endpoint.registerManagedSsh',
        payload: {
          displayName: 'Progress build box',
          host: '127.0.0.1',
          port: 2222,
          username: 'tester',
          remotePort: port,
          remotePlatform: 'posix',
        },
      })
      return result.endpoint.endpointId
    }, remotePort)
    await window.reload({ waitUntil: 'domcontentloaded' })
    await openSettings(window)
    await switchSettingsPage(window, 'endpoints')
    const card = window.locator('.settings-panel__endpoint-card', { hasText: 'Progress build box' })
    await expect(card).toBeVisible()
    await run({
      window,
      card,
      endpointId,
      remoteHome,
      release: async phase => {
        await writeFile(path.join(gates, `${phase}.release`), 'release')
      },
      waitForPhase: async phase => {
        await pollFor(
          async () => {
            const log = await readFile(path.join(gates, 'phases.log'), 'utf8').catch(() => '')
            return log.split('\n').includes(`[opencove-bootstrap-progress:v1] ${phase}`)
              ? true
              : null
          },
          { label: `bootstrap phase ${phase}` },
        )
      },
      assertNoTunnel: async () => {
        expect(
          await access(path.join(gates, 'tunnel-started')).then(
            () => true,
            () => false,
          ),
        ).toBe(false)
      },
      startWorker: async () => {
        const secrets = JSON.parse(
          await readFile(path.join(appUserData, 'worker-endpoint-secrets.json'), 'utf8'),
        ) as { tokensByCredentialRef: Record<string, string> }
        worker = await startRemoteWorker({
          hostname: '127.0.0.1',
          port: remotePort,
          token: secrets.tokensByCredentialRef[endpointId]!,
          userDataDir: path.join(root, 'worker'),
          homeDir: remoteHome,
          approveRoot: remoteHome,
        })
      },
    })
  } finally {
    if (app) {
      await app.electronApp.close()
    }
    if (worker) {
      await stopRemoteWorker(worker.child)
    }
    await removePathWithRetry(fakeSsh)
    await removePathWithRetry(root)
  }
}
