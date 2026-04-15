// @vitest-environment node

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  disposeAndCleanup,
  invoke,
  safeRemoveDirectory,
  sendJson,
  toWsUrl,
  waitForCondition,
  waitForMessage,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

describe('Control Surface HTTP server (multi-endpoint orchestration)', () => {
  it('proxies remote PTY sessions via the home worker', async () => {
    const homeUserDataPath = await mkdtemp(join(tmpdir(), 'opencove-m6-home-pty-'))
    const remoteUserDataPath = await mkdtemp(join(tmpdir(), 'opencove-m6-remote-pty-'))
    const remoteRootPath = await mkdtemp(join(tmpdir(), 'opencove-m6-remote-root-'))

    const homeConnectionFileName = 'control-surface.m6.home.pty.test.json'
    const remoteConnectionFileName = 'control-surface.m6.remote.pty.test.json'
    const homeConnectionFilePath = resolve(homeUserDataPath, homeConnectionFileName)
    const remoteConnectionFilePath = resolve(remoteUserDataPath, remoteConnectionFileName)

    const homeApproved = createApprovedWorkspaceStoreForPath(
      resolve(homeUserDataPath, 'approved-workspaces.json'),
    )
    const remoteApproved = createApprovedWorkspaceStoreForPath(
      resolve(remoteUserDataPath, 'approved-workspaces.json'),
    )
    await remoteApproved.registerRoot(remoteRootPath)

    const remoteDataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
    const remoteExitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()
    const remoteWrites: Array<{ sessionId: string; data: string }> = []
    let lastRemoteSessionId: string | null = null

    const remotePtyRuntime = {
      spawnSession: async () => {
        lastRemoteSessionId = `remote-session-${randomUUID()}`
        return { sessionId: lastRemoteSessionId }
      },
      write: (sessionId: string, data: string) => {
        remoteWrites.push({ sessionId, data })
      },
      resize: () => undefined,
      kill: () => undefined,
      onData: (listener: (event: { sessionId: string; data: string }) => void) => {
        remoteDataListeners.add(listener)
        return () => remoteDataListeners.delete(listener)
      },
      onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => {
        remoteExitListeners.add(listener)
        return () => remoteExitListeners.delete(listener)
      },
    } satisfies ControlSurfacePtyRuntime

    const remoteServer = registerControlSurfaceHttpServer({
      userDataPath: remoteUserDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'remote-token',
      connectionFileName: remoteConnectionFileName,
      approvedWorkspaces: remoteApproved,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: remotePtyRuntime,
    })

    const homeServer = registerControlSurfaceHttpServer({
      userDataPath: homeUserDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'home-token',
      connectionFileName: homeConnectionFileName,
      approvedWorkspaces: homeApproved,
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
      const remoteInfo = await remoteServer.ready
      const remoteBaseUrl = `http://${remoteInfo.hostname}:${remoteInfo.port}`

      const homeInfo = await homeServer.ready
      const homeBaseUrl = `http://${homeInfo.hostname}:${homeInfo.port}`

      const endpointRes = await invoke(homeBaseUrl, 'home-token', {
        kind: 'command',
        id: 'endpoint.register',
        payload: {
          hostname: remoteInfo.hostname,
          port: remoteInfo.port,
          token: 'remote-token',
          displayName: 'remote',
        },
      })
      expect(endpointRes.status, JSON.stringify(endpointRes.data)).toBe(200)
      const endpointId = endpointRes.data.value.endpoint.endpointId

      const projectId = randomUUID()
      const mountRes = await invoke(homeBaseUrl, 'home-token', {
        kind: 'command',
        id: 'mount.create',
        payload: { projectId, endpointId, rootPath: remoteRootPath, name: 'remote-root' },
      })
      expect(mountRes.status, JSON.stringify(mountRes.data)).toBe(200)
      const mountId = mountRes.data.value.mount.mountId

      const spawnRes = await invoke(homeBaseUrl, 'home-token', {
        kind: 'command',
        id: 'pty.spawnInMount',
        payload: { mountId, cols: 80, rows: 24 },
      })
      expect(spawnRes.status, JSON.stringify(spawnRes.data)).toBe(200)
      const homeSessionId = spawnRes.data.value.sessionId

      await waitForCondition(async () => typeof lastRemoteSessionId === 'string', {
        timeoutMs: 2_000,
      })
      const remoteSessionId = lastRemoteSessionId
      expect(typeof remoteSessionId).toBe('string')

      const homeWsUrl = toWsUrl(homeBaseUrl, '/pty', { token: 'home-token' })
      const ws = new WebSocket(homeWsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        ws.once('open', resolvePromise)
        ws.once('error', rejectPromise)
      })

      sendJson(ws, { type: 'hello', protocolVersion: 1, client: { kind: 'cli' } })
      await waitForMessage(ws, message => isRecord(message) && message.type === 'hello_ack')

      sendJson(ws, { type: 'attach', sessionId: homeSessionId, role: 'controller' })
      await waitForMessage(ws, message => isRecord(message) && message.type === 'attached')

      const expectedData = 'hello from remote\n'
      remoteDataListeners.forEach(listener =>
        listener({ sessionId: remoteSessionId as string, data: expectedData }),
      )

      const dataMessage = await waitForMessage(
        ws,
        (message): message is { type: 'data'; sessionId: string; data: string } =>
          isRecord(message) &&
          message.type === 'data' &&
          message.sessionId === homeSessionId &&
          typeof message.data === 'string',
      )
      expect(dataMessage.data).toBe(expectedData)

      sendJson(ws, { type: 'write', sessionId: homeSessionId, data: 'ping' })
      await waitForCondition(async () => remoteWrites.length > 0, { timeoutMs: 2_000 })
      expect(remoteWrites[0]?.sessionId).toBe(remoteSessionId)
      expect(remoteWrites[0]?.data).toBe('ping')

      remoteExitListeners.forEach(listener =>
        listener({ sessionId: remoteSessionId as string, exitCode: 0 }),
      )
      const exitMessage = await waitForMessage(
        ws,
        (message): message is { type: 'exit'; sessionId: string; exitCode: number } =>
          isRecord(message) &&
          message.type === 'exit' &&
          message.sessionId === homeSessionId &&
          typeof message.exitCode === 'number',
      )
      expect(exitMessage.exitCode).toBe(0)

      ws.close()
      await new Promise<void>(resolvePromise => ws.once('close', resolvePromise))

      const pingRemote = await invoke(remoteBaseUrl, 'remote-token', {
        kind: 'query',
        id: 'system.ping',
        payload: null,
      })
      expect(pingRemote.status, JSON.stringify(pingRemote.data)).toBe(200)
    } finally {
      await disposeAndCleanup({
        server: homeServer,
        userDataPath: homeUserDataPath,
        connectionFilePath: homeConnectionFilePath,
        baseUrl: `http://127.0.0.1:${(await homeServer.ready).port}`,
      })
      await disposeAndCleanup({
        server: remoteServer,
        userDataPath: remoteUserDataPath,
        connectionFilePath: remoteConnectionFilePath,
        baseUrl: `http://127.0.0.1:${(await remoteServer.ready).port}`,
      })
      await safeRemoveDirectory(remoteRootPath)
    }
  })
})
