// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
  invoke,
  safeRemoveDirectory,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'
import { createRemoteRecoveryTerminalNode } from './remoteTerminalRecovery.testUtils'

function makePtyRuntime(
  spawnSession: ControlSurfacePtyRuntime['spawnSession'],
): ControlSurfacePtyRuntime {
  return {
    spawnSession,
    write: () => undefined,
    resize: async input => ({
      sessionId: input.sessionId,
      operationId: input.operationId ?? 'worker-binding-resize',
      status: 'accepted',
      changed: true,
      geometry: { cols: input.cols, rows: input.rows, revision: 1 },
      authority: null,
    }),
    kill: () => undefined,
    onData: () => () => undefined,
    onExit: () => () => undefined,
  }
}

describeWithElectronNativeModules('Control Surface node worker binding recovery', () => {
  it('persists a terminal binding and recovers on its original remote worker after restart', async () => {
    const homeUserDataPath = await mkdtemp(join(tmpdir(), 'opencove-home-worker-binding-'))
    const remoteUserDataPath = await mkdtemp(join(tmpdir(), 'opencove-remote-worker-binding-'))
    const remoteRootPath = await mkdtemp(join(tmpdir(), 'opencove-remote-worker-root-'))
    const homeDbPath = resolve(homeUserDataPath, 'opencove.db')
    const homeApproved = createApprovedWorkspaceStoreForPath(
      resolve(homeUserDataPath, 'approved-workspaces.json'),
    )
    const remoteApproved = createApprovedWorkspaceStoreForPath(
      resolve(remoteUserDataPath, 'approved-workspaces.json'),
    )
    await remoteApproved.registerRoot(remoteRootPath)

    let localSpawnCount = 0
    let remoteSpawnCount = 0
    const remoteServer = registerControlSurfaceHttpServer({
      userDataPath: remoteUserDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'remote-worker-binding-token',
      connectionFileName: 'control-surface.worker-binding.remote.json',
      approvedWorkspaces: remoteApproved,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: makePtyRuntime(async () => {
        remoteSpawnCount += 1
        return { sessionId: `remote-recovered-${remoteSpawnCount}` }
      }),
    })

    let homeServer: ReturnType<typeof registerControlSurfaceHttpServer> | null = null
    const startHome = () =>
      registerControlSurfaceHttpServer({
        userDataPath: homeUserDataPath,
        dbPath: homeDbPath,
        hostname: '127.0.0.1',
        port: 0,
        token: 'home-worker-binding-token',
        connectionFileName: 'control-surface.worker-binding.home.json',
        approvedWorkspaces: homeApproved,
        ptyRuntime: makePtyRuntime(async () => {
          localSpawnCount += 1
          return { sessionId: `local-${localSpawnCount}` }
        }),
      })

    try {
      const remoteInfo = await remoteServer.ready
      homeServer = startHome()
      const firstHomeInfo = await homeServer.ready
      const firstHomeUrl = `http://${firstHomeInfo.hostname}:${firstHomeInfo.port}`
      const endpointResponse = await invoke(firstHomeUrl, 'home-worker-binding-token', {
        kind: 'command',
        id: 'endpoint.register',
        payload: {
          hostname: remoteInfo.hostname,
          port: remoteInfo.port,
          token: 'remote-worker-binding-token',
          displayName: 'worker-binding-remote',
        },
      })
      const endpointId = (
        endpointResponse.data as { value?: { endpoint?: { endpointId?: string } } }
      ).value?.endpoint?.endpointId
      expect(endpointId).toEqual(expect.any(String))

      const workspaceId = 'worker-binding-workspace'
      const spaceId = 'worker-binding-space'
      const nodeId = 'worker-binding-terminal'
      const mountResponse = await invoke(firstHomeUrl, 'home-worker-binding-token', {
        kind: 'command',
        id: 'mount.create',
        payload: {
          projectId: workspaceId,
          endpointId,
          rootPath: remoteRootPath,
          name: 'worker-binding-mount',
        },
      })
      const mountId = (mountResponse.data as { value?: { mount?: { mountId?: string } } }).value
        ?.mount?.mountId
      expect(mountId).toEqual(expect.any(String))

      const state = createMinimalState(remoteRootPath, workspaceId, spaceId)
      state.workspaces[0]!.spaces[0]!.nodeIds = [nodeId]
      state.workspaces[0]!.nodes = [
        {
          ...createRemoteRecoveryTerminalNode(nodeId, 'stale-session', remoteRootPath),
          workerBinding: { endpointId: endpointId as string, mountId: mountId as string },
        },
      ]
      const writeResponse = await invoke(firstHomeUrl, 'home-worker-binding-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state },
      })
      expect(writeResponse.status, JSON.stringify(writeResponse.data)).toBe(200)
      await homeServer.dispose()
      homeServer = null

      const db = new Database(homeDbPath, { readonly: true })
      try {
        const row = db.prepare('SELECT worker_binding_json FROM nodes WHERE id = ?').get(nodeId) as
          | { worker_binding_json?: string }
          | undefined
        expect(JSON.parse(row?.worker_binding_json ?? 'null')).toEqual({ endpointId, mountId })
      } finally {
        db.close()
      }

      homeServer = startHome()
      const secondHomeInfo = await homeServer.ready
      const secondHomeUrl = `http://${secondHomeInfo.hostname}:${secondHomeInfo.port}`
      const prepareResponse = await invoke(secondHomeUrl, 'home-worker-binding-token', {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId },
      })
      expect(prepareResponse.status, JSON.stringify(prepareResponse.data)).toBe(200)
      expect(prepareResponse.data).toMatchObject({
        value: {
          nodes: [
            {
              nodeId,
              sessionId: expect.any(String),
              recoveryState: 'restarted',
              workerBinding: { endpointId, mountId },
            },
          ],
        },
      })
      expect(remoteSpawnCount).toBe(1)
      expect(localSpawnCount).toBe(0)
    } finally {
      if (homeServer) {
        await homeServer.dispose()
      }
      await remoteServer.dispose()
      await Promise.all([
        safeRemoveDirectory(homeUserDataPath),
        safeRemoveDirectory(remoteUserDataPath),
        safeRemoveDirectory(remoteRootPath),
      ])
    }
  })
})
