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
    const remoteStateListeners = new Set<
      (event: { sessionId: string; state: 'working' | 'standby' }) => void
    >()
    const remoteMetadataListeners = new Set<
      (event: {
        sessionId: string
        resumeSessionId: string | null
        profileId?: string | null
        runtimeKind?: 'windows' | 'wsl' | 'posix'
      }) => void
    >()
    const remoteWrites: Array<{ sessionId: string; data: string }> = []
    const remoteResizes: Array<{ sessionId: string; cols: number; rows: number }> = []
    let lastRemoteSessionId: string | null = null

    const remotePtyRuntime = {
      spawnSession: async () => {
        lastRemoteSessionId = `remote-session-${randomUUID()}`
        return { sessionId: lastRemoteSessionId }
      },
      write: (sessionId: string, data: string) => {
        remoteWrites.push({ sessionId, data })
      },
      resize: async input => {
        remoteResizes.push({ sessionId: input.sessionId, cols: input.cols, rows: input.rows })
        return {
          sessionId: input.sessionId,
          operationId: input.operationId ?? 'legacy-remote-operation',
          status: 'accepted',
          changed: true,
          geometry: { cols: input.cols, rows: input.rows, revision: null },
          authority: null,
        }
      },
      kill: () => undefined,
      onData: (listener: (event: { sessionId: string; data: string }) => void) => {
        remoteDataListeners.add(listener)
        return () => remoteDataListeners.delete(listener)
      },
      onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => {
        remoteExitListeners.add(listener)
        return () => remoteExitListeners.delete(listener)
      },
      onState: (listener: (event: { sessionId: string; state: 'working' | 'standby' }) => void) => {
        remoteStateListeners.add(listener)
        return () => remoteStateListeners.delete(listener)
      },
      onMetadata: (
        listener: (event: {
          sessionId: string
          resumeSessionId: string | null
          profileId?: string | null
          runtimeKind?: 'windows' | 'wsl' | 'posix'
        }) => void,
      ) => {
        remoteMetadataListeners.add(listener)
        return () => remoteMetadataListeners.delete(listener)
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
        resize: async input => ({
          sessionId: input.sessionId,
          operationId: input.operationId ?? 'legacy-home-operation',
          status: 'accepted',
          changed: true,
          geometry: { cols: input.cols, rows: input.rows, revision: null },
          authority: null,
        }),
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

      remoteStateListeners.forEach(listener =>
        listener({ sessionId: remoteSessionId as string, state: 'working' }),
      )
      const stateMessage = await waitForMessage(
        ws,
        (message): message is { type: 'state'; sessionId: string; state: string } =>
          isRecord(message) &&
          message.type === 'state' &&
          message.sessionId === homeSessionId &&
          message.state === 'working',
      )
      expect(stateMessage.state).toBe('working')

      remoteMetadataListeners.forEach(listener =>
        listener({
          sessionId: remoteSessionId as string,
          resumeSessionId: 'remote-resume-1',
          profileId: 'remote-profile',
          runtimeKind: 'posix',
        }),
      )
      const metadataMessage = await waitForMessage(
        ws,
        (message): message is { type: 'metadata'; sessionId: string; resumeSessionId: string } =>
          isRecord(message) &&
          message.type === 'metadata' &&
          message.sessionId === homeSessionId &&
          message.resumeSessionId === 'remote-resume-1',
      )
      expect(metadataMessage.resumeSessionId).toBe('remote-resume-1')

      sendJson(ws, { type: 'write', sessionId: homeSessionId, data: 'ping' })
      await waitForCondition(async () => remoteWrites.length > 0, { timeoutMs: 2_000 })
      expect(remoteWrites[0]?.sessionId).toBe(remoteSessionId)
      expect(remoteWrites[0]?.data).toBe('ping')

      sendJson(ws, {
        type: 'resize',
        sessionId: homeSessionId,
        cols: 100,
        rows: 32,
        reason: 'frame_commit',
        operationId: 'operation-home-remote-1',
        baseGeometryRevision: null,
        authorityEpoch: 1,
      })
      const resizeResult = await waitForMessage(
        ws,
        (
          message,
        ): message is {
          type: 'resize_result'
          sessionId: string
          operationId: string
          status: string
        } =>
          isRecord(message) &&
          message.type === 'resize_result' &&
          message.sessionId === homeSessionId &&
          message.operationId === 'operation-home-remote-1',
      )
      expect(resizeResult.status).toBe('accepted')
      expect(remoteResizes).toContainEqual({
        sessionId: remoteSessionId,
        cols: 100,
        rows: 32,
      })

      const remoteWsUrl = toWsUrl(remoteBaseUrl, '/pty', { token: 'remote-token' })
      const remoteWs = new WebSocket(remoteWsUrl, 'opencove-pty.v1')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        remoteWs.once('open', resolvePromise)
        remoteWs.once('error', rejectPromise)
      })
      sendJson(remoteWs, { type: 'hello', protocolVersion: 1, client: { kind: 'cli' } })
      await waitForMessage(remoteWs, message => isRecord(message) && message.type === 'hello_ack')
      sendJson(remoteWs, {
        type: 'attach',
        sessionId: remoteSessionId,
        role: 'controller',
      })
      await waitForMessage(
        remoteWs,
        message =>
          isRecord(message) && message.type === 'attached' && message.sessionId === remoteSessionId,
      )
      sendJson(remoteWs, { type: 'request_control', sessionId: remoteSessionId })
      await waitForMessage(
        remoteWs,
        message =>
          isRecord(message) &&
          message.type === 'control_changed' &&
          message.sessionId === remoteSessionId &&
          message.role === 'controller' &&
          message.authorityEpoch === 2,
      )

      sendJson(remoteWs, {
        type: 'resize',
        sessionId: remoteSessionId,
        cols: 110,
        rows: 35,
        reason: 'frame_commit',
        operationId: 'operation-remote-only-revision-2',
        baseGeometryRevision: 1,
        authorityEpoch: 2,
      })
      const remoteOnlyResize = await waitForMessage(
        remoteWs,
        message =>
          isRecord(message) &&
          message.type === 'resize_result' &&
          message.operationId === 'operation-remote-only-revision-2',
      )
      expect(remoteOnlyResize).toMatchObject({
        status: 'accepted',
        geometry: { cols: 110, rows: 35, revision: 2 },
      })

      sendJson(remoteWs, { type: 'release_control', sessionId: remoteSessionId })
      await waitForMessage(
        remoteWs,
        message =>
          isRecord(message) &&
          message.type === 'control_changed' &&
          message.sessionId === remoteSessionId &&
          message.authorityEpoch === 3,
      )
      const proxyControlChanged = waitForMessage(
        remoteWs,
        message =>
          isRecord(message) &&
          message.type === 'control_changed' &&
          message.sessionId === remoteSessionId &&
          message.authorityEpoch === 4,
      )
      const remoteWriteCountBeforeControlReturn = remoteWrites.length
      sendJson(ws, { type: 'write', sessionId: homeSessionId, data: 'return proxy control' })
      await waitForCondition(
        async () => remoteWrites.length > remoteWriteCountBeforeControlReturn,
        { timeoutMs: 2_000 },
      )
      await proxyControlChanged

      sendJson(ws, {
        type: 'resize',
        sessionId: homeSessionId,
        cols: 120,
        rows: 40,
        reason: 'frame_commit',
        operationId: 'operation-home-revision-2-remote-revision-3',
        baseGeometryRevision: 1,
        authorityEpoch: 1,
      })
      const divergentRevisionResize = await waitForMessage(
        ws,
        message =>
          isRecord(message) &&
          message.type === 'resize_result' &&
          message.operationId === 'operation-home-revision-2-remote-revision-3',
      )
      expect(divergentRevisionResize).toMatchObject({
        status: 'accepted',
        geometry: { cols: 120, rows: 40, revision: 2 },
      })
      expect(remoteResizes).toContainEqual({
        sessionId: remoteSessionId,
        cols: 120,
        rows: 40,
      })

      remoteWs.close()
      await new Promise<void>(resolvePromise => remoteWs.once('close', resolvePromise))

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
