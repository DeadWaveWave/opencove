// @vitest-environment node

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  disposeAndCleanup,
  invoke,
  waitForCondition,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

function createNoopPtyRuntime() {
  return {
    spawnSession: async () => ({ sessionId: 'test-session' }),
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
    onData: () => () => undefined,
    onExit: () => () => undefined,
  }
}

describe('Control Surface HTTP server app version metadata', () => {
  it('writes the injected app version to the connection file and system capabilities', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-control-surface-version-'))
    const connectionFileName = 'control-surface.version.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)
    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'test-token',
      appVersion: ' test-version ',
      connectionFileName,
      connectionStartedBy: 'desktop',
      approvedWorkspaces,
      ptyRuntime: createNoopPtyRuntime(),
    })

    const info = await server.ready
    const baseUrl = `http://${info.hostname}:${info.port}`

    try {
      expect(info.appVersion).toBe('test-version')
      await waitForCondition(async () => {
        try {
          await readFile(connectionFilePath, 'utf8')
          return true
        } catch {
          return false
        }
      })

      const connection = JSON.parse(await readFile(connectionFilePath, 'utf8')) as {
        appVersion?: unknown
        startedBy?: unknown
      }
      expect(connection.appVersion).toBe('test-version')
      expect(connection.startedBy).toBe('desktop')

      const capabilities = await invoke(baseUrl, 'test-token', {
        kind: 'query',
        id: 'system.capabilities',
        payload: null,
      })
      expect(capabilities.status, JSON.stringify(capabilities.data)).toBe(200)
      expect(capabilities.data).toMatchObject({
        ok: true,
        value: {
          appVersion: 'test-version',
        },
      })
    } finally {
      await disposeAndCleanup({ server, userDataPath, connectionFilePath, baseUrl })
    }
  })
})
