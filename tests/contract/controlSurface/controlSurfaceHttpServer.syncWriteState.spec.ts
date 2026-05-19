// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
  disposeAndCleanup,
  invoke,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

describe('Control Surface HTTP server (sync.writeState)', () => {
  async function createSyncWriteStateServer() {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-sync-write-state-'))
    const connectionFileName = 'control-surface.sync-write-state.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)
    const workspacePath = resolve(userDataPath, 'workspace')

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'test-token',
      connectionFileName,
      approvedWorkspaces,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'test-session' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
      },
    })

    const info = await server.ready
    const baseUrl = `http://${info.hostname}:${info.port}`

    return { userDataPath, connectionFilePath, workspacePath, server, baseUrl }
  }

  async function readSyncState(
    baseUrl: string,
  ): Promise<{ revision: number; state: unknown | null }> {
    const response = await invoke(baseUrl, 'test-token', {
      kind: 'query',
      id: 'sync.state',
      payload: null,
    })
    expect(response.status, JSON.stringify(response.data)).toBe(200)
    expect((response.data as { ok?: boolean }).ok).toBe(true)
    return (response.data as { value: { revision: number; state: unknown | null } }).value
  }

  it('rejects writes without baseRevision once revision advances', async () => {
    const { userDataPath, connectionFilePath, workspacePath, server, baseUrl } =
      await createSyncWriteStateServer()
    const workspaceId = 'workspace-1'
    const spaceId = 'space-1'

    try {
      const initialState = createMinimalState(workspacePath, workspaceId, spaceId)

      const firstWrite = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: initialState },
      })
      expect(firstWrite.status, JSON.stringify(firstWrite.data)).toBe(200)
      expect((firstWrite.data as { ok?: boolean }).ok).toBe(true)

      const revision = await invoke(baseUrl, 'test-token', {
        kind: 'query',
        id: 'sync.state',
        payload: null,
      })
      expect(revision.status, JSON.stringify(revision.data)).toBe(200)
      expect((revision.data as { ok?: boolean }).ok).toBe(true)
      const currentRevision = (revision.data as { value?: { revision?: number } }).value?.revision
      expect(typeof currentRevision).toBe('number')
      expect(currentRevision ?? 0).toBeGreaterThan(0)

      const secondWrite = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: initialState },
      })
      expect(secondWrite.status, JSON.stringify(secondWrite.data)).toBe(200)
      const envelope = secondWrite.data as { ok?: boolean; error?: { code?: string } }
      expect(envelope.ok).toBe(false)
      expect(envelope.error?.code).toBe('persistence.invalid_state')
    } finally {
      await disposeAndCleanup({ server, userDataPath, connectionFilePath, baseUrl })
    }
  })

  it('rejects an automatic empty workspace overwrite of existing durable state', async () => {
    const { userDataPath, connectionFilePath, workspacePath, server, baseUrl } =
      await createSyncWriteStateServer()

    try {
      const initialState = createMinimalState(workspacePath, 'workspace-1', 'space-1')
      const firstWrite = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: initialState },
      })
      expect(firstWrite.status, JSON.stringify(firstWrite.data)).toBe(200)
      expect((firstWrite.data as { ok?: boolean }).ok).toBe(true)

      const current = await readSyncState(baseUrl)
      const emptyState = {
        ...initialState,
        activeWorkspaceId: null,
        workspaces: [],
      }

      const emptyWrite = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: emptyState, baseRevision: current.revision },
      })
      expect(emptyWrite.status, JSON.stringify(emptyWrite.data)).toBe(200)
      const envelope = emptyWrite.data as { ok?: boolean; error?: { code?: string } }
      expect(envelope.ok).toBe(false)
      expect(envelope.error?.code).toBe('persistence.invalid_state')

      const afterRejectedWrite = await readSyncState(baseUrl)
      expect(afterRejectedWrite.revision).toBe(current.revision)
      expect((afterRejectedWrite.state as { workspaces?: unknown[] }).workspaces).toHaveLength(1)
    } finally {
      await disposeAndCleanup({ server, userDataPath, connectionFilePath, baseUrl })
    }
  })

  it('allows an explicit user-cleared empty workspace write', async () => {
    const { userDataPath, connectionFilePath, workspacePath, server, baseUrl } =
      await createSyncWriteStateServer()

    try {
      const initialState = createMinimalState(workspacePath, 'workspace-1', 'space-1')
      const firstWrite = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: initialState },
      })
      expect(firstWrite.status, JSON.stringify(firstWrite.data)).toBe(200)
      expect((firstWrite.data as { ok?: boolean }).ok).toBe(true)

      const current = await readSyncState(baseUrl)
      const emptyState = {
        ...initialState,
        activeWorkspaceId: null,
        workspaces: [],
      }

      const emptyWrite = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: {
          state: emptyState,
          baseRevision: current.revision,
          allowEmptyWorkspaceOverwrite: true,
        },
      })
      expect(emptyWrite.status, JSON.stringify(emptyWrite.data)).toBe(200)
      expect((emptyWrite.data as { ok?: boolean }).ok).toBe(true)

      const afterAllowedWrite = await readSyncState(baseUrl)
      expect(afterAllowedWrite.revision).toBeGreaterThan(current.revision)
      expect((afterAllowedWrite.state as { workspaces?: unknown[] }).workspaces).toEqual([])
    } finally {
      await disposeAndCleanup({ server, userDataPath, connectionFilePath, baseUrl })
    }
  })
})
