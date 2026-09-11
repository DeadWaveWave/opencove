import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from '@playwright/test'
import type { RegisterWorkerEndpointResult } from '../../src/shared/contracts/dto'
import { launchApp, removePathWithRetry } from './workspace-canvas.helpers'
import { createRemoteOnlyProjectViaWizard } from './m6.endpoints-mounts.addProjectWizard.steps'
import { verifyRemoteOnlyProjectDefaultMount } from './m6.endpoints-mounts.remoteOnly.steps'
import {
  reserveLoopbackPort,
  startRemoteWorker,
  stopRemoteWorker,
} from './m6.endpoints-mounts.integration.helpers'

test('remote project context menu launches terminal and agents in its default remote mount', async () => {
  test.setTimeout(120_000)
  const remoteToken = `m6-e2e-${randomUUID()}`
  const remotePort = await reserveLoopbackPort()
  const remoteHost = '127.0.0.1'
  const remoteBaseDir = await mkdtemp(path.join(tmpdir(), 'opencove-e2e-m6-remote-'))
  const remoteOnlyDir = path.join(remoteBaseDir, 'remote-only')
  await mkdir(remoteOnlyDir, { recursive: true })
  const remoteOnlyDirCanonical = await realpath(remoteOnlyDir).catch(() => remoteOnlyDir)
  const remoteOnlyDirHashes = new Set([
    createHash('sha1').update(remoteOnlyDir).digest('hex').slice(0, 12),
    createHash('sha1').update(remoteOnlyDirCanonical).digest('hex').slice(0, 12),
  ])
  const remoteWorkerUserDataDir = await mkdtemp(
    path.join(tmpdir(), 'opencove-e2e-m6-remote-worker-'),
  )
  const remoteWorkerHomeDir = remoteBaseDir
  const remoteWorker = await startRemoteWorker({
    hostname: remoteHost,
    port: remotePort,
    token: remoteToken,
    userDataDir: remoteWorkerUserDataDir,
    homeDir: remoteWorkerHomeDir,
    approveRoot: remoteBaseDir,
    agentSessionScenario: 'codex-standby-only',
  })
  try {
    const { electronApp, window } = await launchApp({
      env: { OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'codex-standby-only' },
    })
    try {
      await window.evaluate(async () => {
        const result = await window.opencoveApi.persistence.writeWorkspaceStateRaw({
          raw: JSON.stringify({
            formatVersion: 1,
            activeWorkspaceId: null,
            workspaces: [],
            settings: { defaultProvider: 'codex', experimentalRemoteWorkersEnabled: true },
          }),
        })
        if (!result.ok) {
          throw new Error('Failed to reset workspace state')
        }
      })
      await window.reload({ waitUntil: 'domcontentloaded' })
      const remoteEndpointId = await window.evaluate(
        async connection => {
          const result =
            await window.opencoveApi.controlSurface.invoke<RegisterWorkerEndpointResult>({
              kind: 'command',
              id: 'endpoint.register',
              payload: { ...connection, displayName: 'Remote agent regression worker' },
            })
          return result.endpoint.endpointId
        },
        { hostname: remoteHost, port: remotePort, token: remoteToken },
      )
      const projectName = 'Remote Agent Project'
      await createRemoteOnlyProjectViaWizard({
        window,
        projectName,
        remoteEndpointId,
        remoteRootPath: remoteOnlyDir,
      })
      await verifyRemoteOnlyProjectDefaultMount({
        window,
        projectName,
        remoteEndpointId,
        remoteOnlyDir,
        remoteOnlyDirHashes,
      })
      await test.info().attach('remote-project-agent-launch', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  } finally {
    await stopRemoteWorker(remoteWorker.child)
    await removePathWithRetry(remoteWorkerUserDataDir)
    await removePathWithRetry(remoteBaseDir)
  }
})
