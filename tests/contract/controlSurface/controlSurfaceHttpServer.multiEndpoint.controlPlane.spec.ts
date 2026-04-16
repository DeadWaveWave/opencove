// @vitest-environment node

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { toFileUri } from '../../../src/contexts/filesystem/domain/fileUri'
import {
  createInMemoryPersistenceStore,
  disposeAndCleanup,
  invoke,
  safeRemoveDirectory,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

function isEnvelopeErr(value: unknown): value is { ok: false; error: { code?: string } } {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === 'object'
  )
}

describe('Control Surface HTTP server (multi-endpoint orchestration)', () => {
  it('assigns mount sortOrder per project', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-m6-home-sort-'))
    const connectionFileName = 'control-surface.m6.sort.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'home-token',
      connectionFileName,
      approvedWorkspaces,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: randomUUID() }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
      },
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`

      const projectA = randomUUID()
      const projectB = randomUUID()

      const mountA0 = await invoke(baseUrl, 'home-token', {
        kind: 'command',
        id: 'mount.create',
        payload: { projectId: projectA, endpointId: 'local', rootPath: '/tmp/a', name: 'A0' },
      })
      expect(mountA0.status, JSON.stringify(mountA0.data)).toBe(200)
      expect(mountA0.data.value.mount.sortOrder).toBe(0)

      const mountB0 = await invoke(baseUrl, 'home-token', {
        kind: 'command',
        id: 'mount.create',
        payload: { projectId: projectB, endpointId: 'local', rootPath: '/tmp/b', name: 'B0' },
      })
      expect(mountB0.status, JSON.stringify(mountB0.data)).toBe(200)
      expect(mountB0.data.value.mount.sortOrder).toBe(0)

      const mountA1 = await invoke(baseUrl, 'home-token', {
        kind: 'command',
        id: 'mount.create',
        payload: { projectId: projectA, endpointId: 'local', rootPath: '/tmp/c', name: 'A1' },
      })
      expect(mountA1.status, JSON.stringify(mountA1.data)).toBe(200)
      expect(mountA1.data.value.mount.sortOrder).toBe(1)
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })

  it('does not leak endpoint tokens via endpoint.list or sync.state', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-m6-home-'))
    const workspacePath = await mkdtemp(join(tmpdir(), 'opencove-m6-workspace-'))
    const connectionFileName = 'control-surface.m6.token.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(workspacePath)

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'home-token',
      connectionFileName,
      approvedWorkspaces,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: randomUUID() }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
      },
    })

    const secret = 'SECRET_TOKEN_DO_NOT_LEAK'

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`

      const registerRes = await invoke(baseUrl, 'home-token', {
        kind: 'command',
        id: 'endpoint.register',
        payload: { hostname: '127.0.0.1', port: 1234, token: secret },
      })
      expect(registerRes.status, JSON.stringify(registerRes.data)).toBe(200)

      const listRes = await invoke(baseUrl, 'home-token', {
        kind: 'query',
        id: 'endpoint.list',
        payload: null,
      })
      expect(listRes.status, JSON.stringify(listRes.data)).toBe(200)
      expect(JSON.stringify(listRes.data)).not.toContain(secret)

      const stateRes = await invoke(baseUrl, 'home-token', {
        kind: 'query',
        id: 'sync.state',
        payload: null,
      })
      expect(stateRes.status, JSON.stringify(stateRes.data)).toBe(200)
      expect(JSON.stringify(stateRes.data)).not.toContain(secret)
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })

      await safeRemoveDirectory(workspacePath)
    }
  })

  it('returns worker.unavailable when remote endpoint is unreachable', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-m6-home-offline-'))
    const connectionFileName = 'control-surface.m6.offline.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'home-token',
      connectionFileName,
      approvedWorkspaces,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: randomUUID() }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
      },
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`

      const registerRes = await invoke(baseUrl, 'home-token', {
        kind: 'command',
        id: 'endpoint.register',
        payload: { hostname: '127.0.0.1', port: 1, token: 'unreachable' },
      })
      expect(registerRes.status, JSON.stringify(registerRes.data)).toBe(200)
      const endpointId = registerRes.data.value.endpoint.endpointId

      const pingRes = await invoke(baseUrl, 'home-token', {
        kind: 'query',
        id: 'endpoint.ping',
        payload: { endpointId, timeoutMs: 200 },
      })
      expect(pingRes.status, JSON.stringify(pingRes.data)).toBe(200)
      expect(isEnvelopeErr(pingRes.data)).toBe(true)
      expect(pingRes.data.error.code).toBe('worker.unavailable')

      const projectId = randomUUID()
      const mountRes = await invoke(baseUrl, 'home-token', {
        kind: 'command',
        id: 'mount.create',
        payload: { projectId, endpointId, rootPath: '/tmp', name: 'remote' },
      })
      expect(mountRes.status, JSON.stringify(mountRes.data)).toBe(200)
      const mountId = mountRes.data.value.mount.mountId

      const statRes = await invoke(baseUrl, 'home-token', {
        kind: 'query',
        id: 'filesystem.statInMount',
        payload: { mountId, uri: toFileUri('/tmp') },
      })
      expect(statRes.status, JSON.stringify(statRes.data)).toBe(200)
      expect(isEnvelopeErr(statRes.data)).toBe(true)
      expect(statRes.data.error.code).toBe('worker.unavailable')

      const spawnRes = await invoke(baseUrl, 'home-token', {
        kind: 'command',
        id: 'pty.spawnInMount',
        payload: { mountId, cols: 80, rows: 24 },
      })
      expect(spawnRes.status, JSON.stringify(spawnRes.data)).toBe(200)
      expect(isEnvelopeErr(spawnRes.data)).toBe(true)
      expect(spawnRes.data.error.code).toBe('worker.unavailable')
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })
    }
  })

  it('enforces mount root scope for filesystem.*InMount', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-m6-home-scope-'))
    const basePath = await mkdtemp(join(tmpdir(), 'opencove-m6-scope-root-'))
    const mountRootPath = resolve(basePath, 'mount')
    await mkdir(mountRootPath, { recursive: true })

    const inMountPath = resolve(mountRootPath, 'in.txt')
    const outsidePath = resolve(basePath, 'outside.txt')
    await writeFile(inMountPath, 'inside', 'utf8')
    await writeFile(outsidePath, 'outside', 'utf8')

    const connectionFileName = 'control-surface.m6.scope.test.json'
    const connectionFilePath = resolve(userDataPath, connectionFileName)

    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    await approvedWorkspaces.registerRoot(basePath)

    const server = registerControlSurfaceHttpServer({
      userDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'home-token',
      connectionFileName,
      approvedWorkspaces,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: randomUUID() }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
      },
    })

    try {
      const info = await server.ready
      const baseUrl = `http://${info.hostname}:${info.port}`
      const projectId = randomUUID()

      const mountRes = await invoke(baseUrl, 'home-token', {
        kind: 'command',
        id: 'mount.create',
        payload: { projectId, endpointId: 'local', rootPath: mountRootPath, name: 'scope' },
      })
      expect(mountRes.status, JSON.stringify(mountRes.data)).toBe(200)
      const mountId = mountRes.data.value.mount.mountId

      const okRes = await invoke(baseUrl, 'home-token', {
        kind: 'query',
        id: 'filesystem.readFileTextInMount',
        payload: { mountId, uri: toFileUri(inMountPath) },
      })
      expect(okRes.status, JSON.stringify(okRes.data)).toBe(200)
      expect(okRes.data.ok).toBe(true)

      const badRes = await invoke(baseUrl, 'home-token', {
        kind: 'query',
        id: 'filesystem.readFileTextInMount',
        payload: { mountId, uri: toFileUri(outsidePath) },
      })
      expect(badRes.status, JSON.stringify(badRes.data)).toBe(200)
      expect(isEnvelopeErr(badRes.data)).toBe(true)
      expect(badRes.data.error.code).toBe('common.invalid_input')
    } finally {
      await disposeAndCleanup({
        server,
        userDataPath,
        connectionFilePath,
        baseUrl: `http://127.0.0.1:${(await server.ready).port}`,
      })

      await safeRemoveDirectory(basePath)
    }
  })
})
