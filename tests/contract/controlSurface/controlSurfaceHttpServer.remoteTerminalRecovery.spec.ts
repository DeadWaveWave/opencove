// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { expect, it, vi } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
  invoke,
  safeRemoveDirectory,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import {
  countOccurrences,
  createRemoteRecoveryTerminalNode,
} from './remoteTerminalRecovery.testUtils'

describeWithElectronNativeModules('Control Surface remote terminal recovery durability', () => {
  it('keeps one remote epoch and exactly-once presentation across two Home restarts', async () => {
    const homeUserDataPath = await mkdtemp(join(tmpdir(), 'opencove-home-remote-recovery-'))
    const remoteUserDataPath = await mkdtemp(join(tmpdir(), 'opencove-remote-recovery-'))
    const remoteRootPath = await mkdtemp(join(tmpdir(), 'opencove-remote-recovery-root-'))
    const homeDbPath = resolve(homeUserDataPath, 'opencove.db')
    const homeConnectionFileName = 'control-surface.remote-recovery.home.test.json'
    const remoteConnectionFileName = 'control-surface.remote-recovery.target.test.json'
    const homeApproved = createApprovedWorkspaceStoreForPath(
      resolve(homeUserDataPath, 'approved-workspaces.json'),
    )
    const remoteApproved = createApprovedWorkspaceStoreForPath(
      resolve(remoteUserDataPath, 'approved-workspaces.json'),
    )
    await remoteApproved.registerRoot(remoteRootPath)

    const remoteSessionId = 'remote-recovery-session'
    const replacementRemoteSessionId = 'remote-recovery-session-replacement'
    let remoteSpawnCount = 0
    let emitRemoteData: ((event: { sessionId: string; data: string }) => void) | null = null
    let emitRemoteExit: ((event: { sessionId: string; exitCode: number }) => void) | null = null
    const remotePtyRuntime: ControlSurfacePtyRuntime = {
      spawnSession: async () => {
        remoteSpawnCount += 1
        return {
          sessionId: remoteSpawnCount === 1 ? remoteSessionId : replacementRemoteSessionId,
        }
      },
      write: () => undefined,
      resize: async input => ({
        sessionId: input.sessionId,
        operationId: input.operationId ?? 'remote-recovery-resize',
        status: 'accepted',
        changed: true,
        geometry: { cols: input.cols, rows: input.rows, revision: 1 },
        authority: null,
      }),
      kill: () => undefined,
      onData: listener => {
        emitRemoteData = listener
        return () => {
          emitRemoteData = null
        }
      },
      onExit: listener => {
        emitRemoteExit = listener
        return () => {
          emitRemoteExit = null
        }
      },
    }
    const remoteServer = registerControlSurfaceHttpServer({
      userDataPath: remoteUserDataPath,
      hostname: '127.0.0.1',
      port: 0,
      token: 'remote-recovery-token',
      connectionFileName: remoteConnectionFileName,
      approvedWorkspaces: remoteApproved,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: remotePtyRuntime,
    })

    let homeServer: ReturnType<typeof registerControlSurfaceHttpServer> | null = null
    try {
      const remoteInfo = await remoteServer.ready
      const startHomeServer = () =>
        registerControlSurfaceHttpServer({
          userDataPath: homeUserDataPath,
          dbPath: homeDbPath,
          hostname: '127.0.0.1',
          port: 0,
          token: 'home-recovery-token',
          connectionFileName: homeConnectionFileName,
          approvedWorkspaces: homeApproved,
          ptyRuntime: {
            spawnSession: async () => ({ sessionId: randomUUID() }),
            write: () => undefined,
            resize: async input => ({
              sessionId: input.sessionId,
              operationId: input.operationId ?? 'home-recovery-resize',
              status: 'accepted',
              changed: true,
              geometry: { cols: input.cols, rows: input.rows, revision: 1 },
              authority: null,
            }),
            kill: () => undefined,
            onData: () => () => undefined,
            onExit: () => () => undefined,
          },
        })

      homeServer = startHomeServer()
      const home1Info = await homeServer.ready
      const home1BaseUrl = `http://${home1Info.hostname}:${home1Info.port}`

      const endpointResponse = await invoke(home1BaseUrl, 'home-recovery-token', {
        kind: 'command',
        id: 'endpoint.register',
        payload: {
          hostname: remoteInfo.hostname,
          port: remoteInfo.port,
          token: 'remote-recovery-token',
          displayName: 'remote-recovery-target',
        },
      })
      expect(endpointResponse.status, JSON.stringify(endpointResponse.data)).toBe(200)
      const endpointId = (
        endpointResponse.data as { value?: { endpoint?: { endpointId?: string } } }
      ).value?.endpoint?.endpointId
      expect(endpointId).toEqual(expect.any(String))

      const workspaceId = randomUUID()
      const spaceId = randomUUID()
      const mountResponse = await invoke(home1BaseUrl, 'home-recovery-token', {
        kind: 'command',
        id: 'mount.create',
        payload: {
          projectId: workspaceId,
          endpointId,
          rootPath: remoteRootPath,
          name: 'remote-recovery-root',
        },
      })
      expect(mountResponse.status, JSON.stringify(mountResponse.data)).toBe(200)
      const mountId = (mountResponse.data as { value?: { mount?: { mountId?: string } } }).value
        ?.mount?.mountId
      expect(mountId).toEqual(expect.any(String))

      const spawnResponse = await invoke(home1BaseUrl, 'home-recovery-token', {
        kind: 'command',
        id: 'pty.spawnInMount',
        payload: {
          mountId,
          command: process.execPath,
          args: ['-e', ''],
          cols: 80,
          rows: 24,
        },
      })
      expect(spawnResponse.status, JSON.stringify(spawnResponse.data)).toBe(200)
      const homeSessionId = (spawnResponse.data as { value?: { sessionId?: string } }).value
        ?.sessionId
      expect(homeSessionId).toEqual(expect.any(String))
      expect(remoteSpawnCount).toBe(1)

      const nodeId = 'remote-recovery-node'
      const state = createMinimalState(remoteRootPath, workspaceId, spaceId)
      state.workspaces[0]!.spaces[0]!.nodeIds = [nodeId]
      state.workspaces[0]!.nodes = [
        createRemoteRecoveryTerminalNode(nodeId, homeSessionId as string, remoteRootPath),
      ]
      const stateResponse = await invoke(home1BaseUrl, 'home-recovery-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state },
      })
      expect(stateResponse.status, JSON.stringify(stateResponse.data)).toBe(200)

      const beforeRestartToken = 'REMOTE_BEFORE_HOME_RESTART'
      emitRemoteData?.({
        sessionId: remoteSessionId,
        data: `${beforeRestartToken}\r\n`,
      })
      await vi.waitFor(
        async () => {
          const response = await invoke(home1BaseUrl, 'home-recovery-token', {
            kind: 'query',
            id: 'session.presentationSnapshot',
            payload: { sessionId: homeSessionId },
          })
          expect(response.status).toBe(200)
          expect(response.data).toMatchObject({
            value: expect.objectContaining({
              serializedScreen: expect.stringContaining(beforeRestartToken),
            }),
          })
        },
        { timeout: 3_000, interval: 20 },
      )

      await homeServer.dispose()
      homeServer = null

      const firstDowntimeToken = 'REMOTE_WHILE_HOME_ONE_DOWN'
      const archivedEpochToken = 'REMOTE_ARCHIVED_EPOCH_PREFIX'
      emitRemoteData?.({
        sessionId: remoteSessionId,
        data: `${firstDowntimeToken}\r\n`,
      })

      const db = new Database(homeDbPath)
      try {
        const row = db
          .prepare(
            'SELECT binding_json, presentation_json FROM terminal_recovery_records WHERE node_id = ?',
          )
          .get(nodeId) as { binding_json?: string; presentation_json?: string } | undefined
        const binding = JSON.parse(row?.binding_json ?? 'null') as {
          sessionId?: unknown
          route?: { kind?: unknown; endpointId?: unknown; remoteSessionId?: unknown }
        } | null
        expect(binding).toMatchObject({
          sessionId: homeSessionId,
          route: {
            kind: 'remote',
            endpointId,
            remoteSessionId,
          },
        })
        const legacyEnvelope = JSON.parse(row?.presentation_json ?? 'null') as {
          downstreamReplayCursor?: number
          archivedEpochs?: unknown[]
        } | null
        expect(legacyEnvelope?.downstreamReplayCursor).toBeGreaterThanOrEqual(1)
        if (legacyEnvelope) {
          delete legacyEnvelope.downstreamReplayCursor
          legacyEnvelope.archivedEpochs = [
            {
              runtimeEpoch: 'archived-remote-epoch',
              cols: 80,
              rows: 24,
              bufferKind: 'normal',
              serializedScreen: `${archivedEpochToken}\r\n`,
            },
          ]
          db.prepare(
            `UPDATE terminal_recovery_records
             SET presentation_json = ?, checksum = NULL
             WHERE node_id = ?`,
          ).run(JSON.stringify(legacyEnvelope), nodeId)
        }
      } finally {
        db.close()
      }

      homeServer = startHomeServer()
      const home2Info = await homeServer.ready
      const home2BaseUrl = `http://${home2Info.hostname}:${home2Info.port}`
      const prepareResponse = await invoke(home2BaseUrl, 'home-recovery-token', {
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
              sessionId: homeSessionId,
              recoveryState: 'live',
              isLiveSessionReattach: true,
            },
          ],
        },
      })
      expect(remoteSpawnCount).toBe(1)
      await vi.waitFor(
        async () => {
          const snapshotResponse = await invoke(home2BaseUrl, 'home-recovery-token', {
            kind: 'query',
            id: 'session.presentationSnapshot',
            payload: { sessionId: homeSessionId },
          })
          expect(snapshotResponse.status).toBe(200)
          const serializedScreen = String(
            (snapshotResponse.data as { value?: { serializedScreen?: unknown } }).value
              ?.serializedScreen ?? '',
          )
          expect(countOccurrences(serializedScreen, beforeRestartToken)).toBe(1)
          expect(countOccurrences(serializedScreen, firstDowntimeToken)).toBe(1)
          expect(countOccurrences(serializedScreen, archivedEpochToken)).toBe(1)
        },
        { timeout: 3_000, interval: 20 },
      )

      await homeServer.dispose()
      homeServer = null

      const secondDowntimeToken = 'REMOTE_WHILE_HOME_TWO_DOWN'
      emitRemoteData?.({
        sessionId: remoteSessionId,
        data: `${secondDowntimeToken}\r\n`,
      })

      homeServer = startHomeServer()
      const home3Info = await homeServer.ready
      const home3BaseUrl = `http://${home3Info.hostname}:${home3Info.port}`
      const secondPrepareResponse = await invoke(home3BaseUrl, 'home-recovery-token', {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId },
      })
      expect(secondPrepareResponse.status, JSON.stringify(secondPrepareResponse.data)).toBe(200)
      expect(secondPrepareResponse.data).toMatchObject({
        value: {
          nodes: [
            {
              nodeId,
              sessionId: homeSessionId,
              recoveryState: 'live',
              isLiveSessionReattach: true,
            },
          ],
        },
      })
      expect(remoteSpawnCount).toBe(1)

      await vi.waitFor(
        async () => {
          const snapshotResponse = await invoke(home3BaseUrl, 'home-recovery-token', {
            kind: 'query',
            id: 'session.presentationSnapshot',
            payload: { sessionId: homeSessionId },
          })
          expect(snapshotResponse.status).toBe(200)
          const serializedScreen = String(
            (snapshotResponse.data as { value?: { serializedScreen?: unknown } }).value
              ?.serializedScreen ?? '',
          )
          expect(countOccurrences(serializedScreen, beforeRestartToken)).toBe(1)
          expect(countOccurrences(serializedScreen, firstDowntimeToken)).toBe(1)
          expect(countOccurrences(serializedScreen, secondDowntimeToken)).toBe(1)
          expect(countOccurrences(serializedScreen, archivedEpochToken)).toBe(1)
        },
        { timeout: 3_000, interval: 20 },
      )

      await homeServer.dispose()
      homeServer = null
      const recoveredDb = new Database(homeDbPath, { readonly: true })
      try {
        const row = recoveredDb
          .prepare(
            `SELECT generation, binding_json, presentation_json, raw_tail
             FROM terminal_recovery_records WHERE node_id = ?`,
          )
          .get(nodeId) as
          | {
              generation: number
              binding_json: string
              presentation_json: string
              raw_tail: string
            }
          | undefined
        expect(row?.generation).toBe(1)
        expect(row?.binding_json).toContain(homeSessionId as string)
        const presentationEnvelope = JSON.parse(row?.presentation_json ?? 'null') as {
          archivedEpochs?: unknown[]
          serializedScreen?: unknown
          downstreamReplayCursor?: unknown
        } | null
        expect(presentationEnvelope?.archivedEpochs).toEqual([
          expect.objectContaining({
            runtimeEpoch: 'archived-remote-epoch',
            serializedScreen: expect.stringContaining(archivedEpochToken),
          }),
        ])
        expect(presentationEnvelope?.downstreamReplayCursor).toBeGreaterThanOrEqual(3)
        const serializedScreen = String(presentationEnvelope?.serializedScreen ?? '')
        const rawTail = row?.raw_tail ?? ''
        for (const token of [beforeRestartToken, firstDowntimeToken, secondDowntimeToken]) {
          expect(countOccurrences(serializedScreen, token)).toBe(1)
          expect(countOccurrences(rawTail, token)).toBeLessThanOrEqual(1)
        }
        expect(serializedScreen).not.toContain(archivedEpochToken)
        expect(rawTail).not.toContain(archivedEpochToken)
      } finally {
        recoveredDb.close()
      }

      const finalExitedToken = 'REMOTE_FINAL_OUTPUT_WHILE_HOME_DOWN'
      emitRemoteData?.({ sessionId: remoteSessionId, data: `${finalExitedToken}\r\n` })
      emitRemoteExit?.({ sessionId: remoteSessionId, exitCode: 0 })

      homeServer = startHomeServer()
      const home4Info = await homeServer.ready
      const home4BaseUrl = `http://${home4Info.hostname}:${home4Info.port}`
      const replacementPrepare = await invoke(home4BaseUrl, 'home-recovery-token', {
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: { workspaceId },
      })
      expect(replacementPrepare.status, JSON.stringify(replacementPrepare.data)).toBe(200)
      const replacementNode = (
        replacementPrepare.data as {
          value?: {
            nodes?: Array<{
              nodeId?: string
              sessionId?: string
              recoveryState?: string
              isLiveSessionReattach?: boolean
            }>
          }
        }
      ).value?.nodes?.find(node => node.nodeId === nodeId)
      expect(replacementNode).toMatchObject({
        nodeId,
        sessionId: expect.any(String),
        isLiveSessionReattach: false,
      })
      expect(replacementNode?.sessionId).not.toBe(homeSessionId)
      expect(remoteSpawnCount).toBe(2)

      const currentStateResponse = await invoke(home4BaseUrl, 'home-recovery-token', {
        kind: 'query',
        id: 'sync.state',
        payload: null,
      })
      const currentRevision = (currentStateResponse.data as { value?: { revision?: number } }).value
        ?.revision
      expect(currentRevision).toEqual(expect.any(Number))
      state.workspaces[0]!.nodes[0]!.sessionId = replacementNode?.sessionId ?? null
      const replacementStateWrite = await invoke(home4BaseUrl, 'home-recovery-token', {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state, baseRevision: currentRevision },
      })
      expect(replacementStateWrite.status, JSON.stringify(replacementStateWrite.data)).toBe(200)

      await homeServer.dispose()
      homeServer = null
      const finalDb = new Database(homeDbPath, { readonly: true })
      try {
        const row = finalDb
          .prepare(
            `SELECT generation, binding_json, presentation_json
             FROM terminal_recovery_records WHERE node_id = ?`,
          )
          .get(nodeId) as
          | { generation: number; binding_json: string; presentation_json: string }
          | undefined
        expect(row?.generation).toBe(2)
        expect(row?.binding_json).toContain(replacementNode?.sessionId ?? '')
        expect(row?.binding_json).toContain(replacementRemoteSessionId)
        const envelope = JSON.parse(row?.presentation_json ?? 'null') as {
          archivedEpochs?: Array<{ serializedScreen?: string }>
          serializedScreen?: string
        } | null
        const archived = (envelope?.archivedEpochs ?? [])
          .map(epoch => epoch.serializedScreen ?? '')
          .join('')
        expect(countOccurrences(archived, finalExitedToken)).toBe(1)
        expect(envelope?.serializedScreen ?? '').not.toContain(finalExitedToken)
      } finally {
        finalDb.close()
      }
    } finally {
      await homeServer?.dispose()
      await remoteServer.dispose()
      await safeRemoveDirectory(homeUserDataPath)
      await safeRemoveDirectory(remoteUserDataPath)
      await safeRemoveDirectory(remoteRootPath)
    }
  })
})
