// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopManagedControlSurface } from '../../../src/app/worker/desktopManagedControlSurface'
import {
  readHomeWorkerConfigFile,
  writeHomeWorkerConfigFile,
  type HomeWorkerConfigFile,
} from '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfig'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { hashWebUiPassword } from '../../../src/contexts/settings/infrastructure/homeWorker/webUiPassword'
import {
  createInMemoryPersistenceStore,
  invoke,
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

function initialConfig(): HomeWorkerConfigFile {
  return {
    version: 1,
    mode: 'local',
    remote: null,
    webUi: {
      enabled: false,
      port: null,
      exposeOnLan: false,
      passwordHash: null,
    },
    updatedAt: null,
  }
}

describe('Desktop-managed Control Surface Web access', () => {
  const cleanupPaths: string[] = []

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map(async path => await rm(path, { recursive: true })))
  })

  it('rotates Web password sessions without closing the private PTY transport', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-desktop-control-auth-'))
    cleanupPaths.push(userDataPath)
    const config = initialConfig()
    config.webUi = {
      enabled: true,
      port: null,
      exposeOnLan: true,
      passwordHash: await hashWebUiPassword('old-test-password'),
    }
    await writeHomeWorkerConfigFile(userDataPath, config)
    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    const server = createDesktopManagedControlSurface({
      initialConfig: config,
      server: {
        userDataPath,
        token: 'test-token',
        approvedWorkspaces,
        createPersistenceStore: async () => createInMemoryPersistenceStore(),
        ptyRuntime: createNoopPtyRuntime(),
        connectionFileName: 'desktop-control.auth.test.json',
      },
    })

    try {
      const privateInfo = await server.ready
      const privateBaseUrl = `http://${privateInfo.hostname}:${privateInfo.port}`
      const before = await invoke(privateBaseUrl, privateInfo.token, {
        kind: 'query',
        id: 'worker.config.get',
        payload: null,
      })
      const webPort = before.data.value?.webAccess.port as number
      const invalidSecurity = await invoke(privateBaseUrl, privateInfo.token, {
        kind: 'command',
        id: 'worker.webAccess.setSecurity',
        payload: {
          value: { exposeOnLan: true, password: 42 },
          expectedUpdatedAt: before.data.value?.config.updatedAt,
        },
      })
      expect(invalidSecurity.data.ok).toBe(false)
      expect(invalidSecurity.data.error?.code).toBe('common.invalid_input')

      const loginResponse = await fetch(`http://127.0.0.1:${webPort}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: 'old-test-password', redirectPath: '/' }),
        redirect: 'manual',
      })
      expect(loginResponse.status).toBe(302)
      const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0] ?? ''
      expect(cookie).toContain('opencove_session=')
      const forbiddenConfig = await fetch(`http://127.0.0.1:${webPort}/invoke`, {
        method: 'POST',
        headers: {
          cookie,
          origin: `http://127.0.0.1:${webPort}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ kind: 'query', id: 'worker.config.get', payload: null }),
      })
      expect(forbiddenConfig.status).toBe(403)

      const webSocket = new WebSocket(`ws://127.0.0.1:${webPort}/pty`, 'opencove-pty.v1', {
        headers: { cookie, origin: `http://127.0.0.1:${webPort}` },
      })
      const privateSocket = new WebSocket(
        `ws://${privateInfo.hostname}:${privateInfo.port}/pty?token=${privateInfo.token}`,
        'opencove-pty.v1',
      )
      await Promise.all(
        [webSocket, privateSocket].map(
          async socket =>
            await new Promise<void>((resolvePromise, rejectPromise) => {
              socket.once('open', resolvePromise)
              socket.once('error', rejectPromise)
            }),
        ),
      )
      webSocket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, client: { kind: 'web' } }))
      privateSocket.send(
        JSON.stringify({ type: 'hello', protocolVersion: 1, client: { kind: 'desktop' } }),
      )
      const webClosed = new Promise<void>(resolvePromise => webSocket.once('close', resolvePromise))

      const changed = await invoke(privateBaseUrl, privateInfo.token, {
        kind: 'command',
        id: 'worker.webAccess.setSecurity',
        payload: {
          value: { exposeOnLan: true, password: 'new-test-password' },
          expectedUpdatedAt: before.data.value?.config.updatedAt,
        },
      })
      expect(changed.data.ok).toBe(true)
      expect(changed.data.value?.webAccess).toMatchObject({
        state: 'active',
        port: webPort,
        generation: before.data.value?.webAccess.generation,
      })
      await webClosed

      await new Promise<void>((resolvePromise, rejectPromise) => {
        const timeout = setTimeout(
          () => rejectPromise(new Error('Private socket did not pong')),
          2_000,
        )
        privateSocket.once('pong', () => {
          clearTimeout(timeout)
          resolvePromise()
        })
        privateSocket.ping()
      })

      const oldLogin = await fetch(`http://127.0.0.1:${webPort}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: 'old-test-password', redirectPath: '/' }),
        redirect: 'manual',
      })
      expect(oldLogin.status).toBe(401)
      const newLogin = await fetch(`http://127.0.0.1:${webPort}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: 'new-test-password', redirectPath: '/' }),
        redirect: 'manual',
      })
      expect(newLogin.status).toBe(302)
      privateSocket.close()
    } finally {
      await server.dispose()
    }
  })

  it('keeps the previous listener and durable config when a candidate port is occupied', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-desktop-control-rollback-'))
    cleanupPaths.push(userDataPath)
    const config = initialConfig()
    config.webUi.enabled = true
    await writeHomeWorkerConfigFile(userDataPath, config)
    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    const server = createDesktopManagedControlSurface({
      initialConfig: config,
      server: {
        userDataPath,
        token: 'test-token',
        approvedWorkspaces,
        createPersistenceStore: async () => createInMemoryPersistenceStore(),
        ptyRuntime: createNoopPtyRuntime(),
        connectionFileName: 'desktop-control.rollback.test.json',
      },
    })
    const occupied = createServer()

    try {
      const privateInfo = await server.ready
      const privateBaseUrl = `http://${privateInfo.hostname}:${privateInfo.port}`
      const before = await invoke(privateBaseUrl, privateInfo.token, {
        kind: 'query',
        id: 'worker.config.get',
        payload: null,
      })
      expect(before.data.value?.webAccess.state).toBe('active')
      const activePort = before.data.value?.webAccess.port as number

      await new Promise<void>((resolvePromise, rejectPromise) => {
        occupied.once('error', rejectPromise)
        occupied.listen(0, '127.0.0.1', resolvePromise)
      })
      const occupiedAddress = occupied.address()
      if (!occupiedAddress || typeof occupiedAddress === 'string') {
        throw new Error('Missing occupied test address')
      }

      const failed = await invoke(privateBaseUrl, privateInfo.token, {
        kind: 'command',
        id: 'worker.webAccess.setSettings',
        payload: {
          value: { enabled: true, port: occupiedAddress.port },
          expectedUpdatedAt: before.data.value?.config.updatedAt,
        },
      })
      expect(failed.status).toBe(200)
      expect(failed.data.ok).toBe(false)
      expect(failed.data.error?.code).toBe('worker.unavailable')

      const after = await invoke(privateBaseUrl, privateInfo.token, {
        kind: 'query',
        id: 'worker.config.get',
        payload: null,
      })
      expect(after.data.value?.webAccess).toMatchObject({ state: 'active', port: activePort })
      expect(after.data.value?.config.webUi.port).toBeNull()
      expect((await readHomeWorkerConfigFile(userDataPath)).webUi.port).toBeNull()
    } finally {
      await new Promise<void>(resolvePromise => occupied.close(() => resolvePromise()))
      await server.dispose()
    }
  })

  it('applies Web enable and disable through the stable private endpoint', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-desktop-control-'))
    cleanupPaths.push(userDataPath)
    const config = initialConfig()
    await writeHomeWorkerConfigFile(userDataPath, config)
    const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
      resolve(userDataPath, 'approved-workspaces.json'),
    )
    const server = createDesktopManagedControlSurface({
      initialConfig: config,
      server: {
        userDataPath,
        token: 'test-token',
        approvedWorkspaces,
        createPersistenceStore: async () => createInMemoryPersistenceStore(),
        ptyRuntime: createNoopPtyRuntime(),
        connectionFileName: 'desktop-control.test.json',
        appVersion: 'test-version',
      },
    })

    try {
      const privateInfo = await server.ready
      const privateBaseUrl = `http://${privateInfo.hostname}:${privateInfo.port}`
      const before = await invoke(privateBaseUrl, privateInfo.token, {
        kind: 'query',
        id: 'worker.config.get',
        payload: null,
      })
      expect(before.data.value?.webAccess.state).toBe('disabled')

      const enabled = await invoke(privateBaseUrl, privateInfo.token, {
        kind: 'command',
        id: 'worker.webAccess.setSettings',
        payload: {
          value: { enabled: true, port: 0 },
          expectedUpdatedAt: null,
        },
      })
      expect(enabled.status).toBe(200)
      expect(enabled.data.ok).toBe(true)
      expect(enabled.data.value?.webAccess.state).toBe('active')
      const webPort = enabled.data.value?.webAccess.port as number
      expect(webPort).toBeGreaterThan(0)
      expect(webPort).not.toBe(privateInfo.port)
      expect((await readHomeWorkerConfigFile(userDataPath)).webUi.enabled).toBe(true)

      const disabled = await invoke(privateBaseUrl, privateInfo.token, {
        kind: 'command',
        id: 'worker.webAccess.setSettings',
        payload: {
          value: { enabled: false, port: 0 },
          expectedUpdatedAt: enabled.data.value?.config.updatedAt,
        },
      })
      expect(disabled.data.ok).toBe(true)
      expect(disabled.data.value?.webAccess.state).toBe('disabled')
      expect((await readHomeWorkerConfigFile(userDataPath)).webUi.enabled).toBe(false)

      const ping = await invoke(privateBaseUrl, privateInfo.token, {
        kind: 'query',
        id: 'system.ping',
        payload: null,
      })
      expect(ping.data.ok).toBe(true)
      expect((await server.ready).createdAt).toBe(privateInfo.createdAt)
    } finally {
      await server.dispose()
    }
  })
})
