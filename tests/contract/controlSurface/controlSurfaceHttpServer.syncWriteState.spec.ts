// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createBrowserPersistenceApi } from '../../../src/app/renderer/browser/browserOpenCoveApi.persistence'
import { normalizePersistedAppStateForMerge } from '../../../src/app/renderer/browser/browserOpenCoveApi.helpers'
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

  it('rebases a stale browser publication onto an external write through the real HTTP conflict envelope', async () => {
    const { userDataPath, connectionFilePath, workspacePath, server, baseUrl } =
      await createSyncWriteStateServer()
    const fetchHttp = globalThis.fetch
    // Use the real browser transport/error projection, pointing its relative URL at this server.
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      fetchHttp(new URL(url, baseUrl), {
        ...init,
        headers: { ...init?.headers, authorization: 'Bearer test-token' },
      }),
    )
    try {
      await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: createMinimalState(workspacePath, 'workspace-1', 'space-1') },
      })
      const browser = createBrowserPersistenceApi()
      const accepted = await browser.readAppState()
      const local = normalizePersistedAppStateForMerge(accepted.state)!
      const external = structuredClone(local)
      external.workspaces[0].name = 'External rename'
      const committed = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: external, baseRevision: accepted.revision },
      })
      expect(committed.data).toMatchObject({ ok: true })

      const stale = await invoke(baseUrl, 'test-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: local, baseRevision: accepted.revision },
      })
      expect(stale.data).toMatchObject({
        ok: false,
        error: {
          code: 'persistence.invalid_state',
          debugMessage: 'sync.writeState revision conflict (base=1, current=2)',
        },
      })

      local.settings.releaseNotesSeenVersion = 'local-edit'
      const publication = await browser.writeAppState({
        state: local,
        baseRevision: accepted.revision,
      })
      expect(publication, JSON.stringify(publication)).toMatchObject({
        ok: true,
        merged: true,
        revision: 3,
      })
      const expected = {
        revision: 3,
        state: {
          workspaces: [{ name: 'External rename' }],
          settings: { releaseNotesSeenVersion: 'local-edit' },
        },
      }
      expect(await readSyncState(baseUrl)).toMatchObject(expected)
      expect(await browser.readAppState()).toMatchObject(expected)
      expect(await createBrowserPersistenceApi().readAppState()).toMatchObject(expected)
    } finally {
      vi.unstubAllGlobals()
      await disposeAndCleanup({ server, userDataPath, connectionFilePath, baseUrl })
    }
  })
})
