import { resolve } from 'node:path'
import { TerminalRecoveryOwner } from '../../../../contexts/terminal/application/recovery/TerminalRecoveryOwner'
import {
  TerminalRecoveryBindingCoordinator,
  type TerminalRecoveryBindingCandidate,
} from '../../../../contexts/terminal/application/recovery/TerminalRecoveryBindingCoordinator'
import { createSqliteTerminalRecoveryRepository } from '../../../../contexts/terminal/infrastructure/recovery/createSqliteTerminalRecoveryRepository'
import { composeTerminalRecoveryScrollback } from '../../../../contexts/terminal/domain/recovery/terminalRecovery'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { NormalizedPersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import {
  RemotePtyRecoveryBlockedError,
  type MultiEndpointPtyRuntime,
} from '../ptyStream/multiEndpointPtyRuntime'
import type { PtyStreamService } from '../ptyStream/ptyStreamService'
import type { TerminalRecoveryFlushResult } from '../../../../contexts/terminal/application/recovery/TerminalRecoveryOwner'

type TerminalRecoveryResources = {
  repository: Awaited<ReturnType<typeof createSqliteTerminalRecoveryRepository>>
  owner: TerminalRecoveryOwner
  bindingCoordinator: TerminalRecoveryBindingCoordinator
}

export interface ControlSurfaceTerminalRecoveryRuntime {
  onStatePersisted: (state: NormalizedPersistedAppState) => Promise<void>
  restoreTerminalSession: (input: { nodeId: string; sessionId: string }) => Promise<boolean>
  drainBeforeShutdown: () => Promise<void>
  dispose: () => Promise<void>
}

export type TerminalRecoveryBindingCandidateResolution = {
  candidates: TerminalRecoveryBindingCandidate[]
  /** Active terminal nodes whose runtime route was temporarily unobservable. */
  unavailableNodeIds: string[]
}

export type RemoteTerminalRecoveryReplayPlan = {
  afterSeq: number | null
  serializedScreenBaseline: string | null
  resetRawTailOnBind: boolean
}

/**
 * A checkpoint without a downstream cursor has no trustworthy overlap boundary with remote
 * replay. Fail closed by rebuilding from the Remote Hub's earliest available chunk instead of
 * merging two potentially overlapping histories. Omitting afterSeq also avoids forcing an
 * overflow against an already-truncated replay window.
 */
export function resolveRemoteTerminalRecoveryReplayPlan(
  checkpoint:
    | { serializedScreen: string; downstreamReplayCursor?: number | null }
    | null
    | undefined,
): RemoteTerminalRecoveryReplayPlan {
  const cursor = checkpoint?.downstreamReplayCursor
  if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0) {
    return {
      afterSeq: null,
      serializedScreenBaseline: null,
      resetRawTailOnBind: true,
    }
  }
  return {
    afterSeq: cursor,
    serializedScreenBaseline: checkpoint?.serializedScreen ?? '',
    resetRawTailOnBind: false,
  }
}

export function assertAuthoritativeRemoteCheckpointCommitted(
  checkpoint: TerminalRecoveryFlushResult | null,
): void {
  if (checkpoint?.status === 'complete' && checkpoint.committed > 0) {
    return
  }
  const reasons = checkpoint?.failures.map(failure => failure.reason).join(', ') || 'not_committed'
  throw new RemotePtyRecoveryBlockedError(
    `Authoritative remote PTY snapshot was not persisted before attach: ${reasons}`,
  )
}

export async function resolveTerminalRecoveryBindingCandidates(options: {
  nodes: ReadonlyArray<{ nodeId: string; sessionId: string }>
  homeWorkerInstanceId: string
  resolveRoute: MultiEndpointPtyRuntime['resolveRecoveryRoute']
}): Promise<TerminalRecoveryBindingCandidateResolution> {
  const resolved = await Promise.all(
    options.nodes.map(async node => {
      const route = await options
        .resolveRoute(node.sessionId, options.homeWorkerInstanceId)
        .catch(() => null)
      return route
        ? ({ status: 'resolved', candidate: { ...node, route } } as const)
        : ({ status: 'unavailable', nodeId: node.nodeId } as const)
    }),
  )
  return {
    candidates: resolved.flatMap(result =>
      result.status === 'resolved' ? [result.candidate] : [],
    ),
    unavailableNodeIds: resolved.flatMap(result =>
      result.status === 'unavailable' ? [result.nodeId] : [],
    ),
  }
}

export function createControlSurfaceTerminalRecoveryRuntime(options: {
  enabled: boolean
  userDataPath: string
  dbPath?: string
  getPersistenceStore: () => Promise<PersistenceStore>
  ptyRuntime: MultiEndpointPtyRuntime
  ptyStreamService: PtyStreamService
}): ControlSurfaceTerminalRecoveryRuntime {
  const resourcesPromise: Promise<TerminalRecoveryResources | null> = options.enabled
    ? options
        .getPersistenceStore()
        .then(async () => {
          const repository = await createSqliteTerminalRecoveryRepository({
            dbPath: options.dbPath ?? resolve(options.userDataPath, 'opencove.db'),
          })
          const owner = new TerminalRecoveryOwner({
            persistence: repository,
            presentation: {
              snapshotSession: async (sessionId, captureMutationBoundary) => {
                const captured = await options.ptyRuntime.captureRecoveryPresentationSnapshot(
                  sessionId,
                  async () => {
                    captureMutationBoundary()
                    return await options.ptyStreamService.hub.recoveryPresentationSnapshotSession(
                      sessionId,
                    )
                  },
                )
                const snapshot = captured.snapshot
                return {
                  appliedSeq: snapshot.appliedSeq,
                  presentationRevision: snapshot.presentationRevision,
                  cols: snapshot.cols,
                  rows: snapshot.rows,
                  geometryRevision: snapshot.geometryRevision ?? null,
                  bufferKind: snapshot.bufferKind,
                  cursor: snapshot.cursor,
                  title: snapshot.title,
                  serializedScreen: snapshot.serializedScreen,
                  downstreamReplayCursor: captured.downstreamReplayCursor,
                }
              },
            },
          })
          const bindingCoordinator = new TerminalRecoveryBindingCoordinator({
            persistence: repository,
            owner,
          })
          options.ptyStreamService.setRecoveryOwner(owner)
          return { repository, owner, bindingCoordinator }
        })
        .catch(error => {
          const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          process.stderr.write(`[opencove] terminal recovery initialization degraded: ${detail}\n`)
          return null
        })
    : Promise.resolve(null)

  const onStatePersisted = async (state: NormalizedPersistedAppState): Promise<void> => {
    const resources = await resourcesPromise
    if (!resources) {
      return
    }

    const activeSessionIds = new Set(
      options.ptyStreamService.hub
        .listSessions()
        .sessions.filter(session => session.status === 'running')
        .map(session => session.sessionId),
    )
    const activeTerminalNodes = state.workspaces.flatMap(workspace =>
      workspace.nodes.filter(
        node =>
          node.kind === 'terminal' &&
          Boolean(node.sessionId) &&
          activeSessionIds.has(node.sessionId ?? ''),
      ),
    )
    const resolution = await resolveTerminalRecoveryBindingCandidates({
      nodes: activeTerminalNodes.map(node => ({
        nodeId: node.id,
        sessionId: node.sessionId ?? '',
      })),
      homeWorkerInstanceId: options.ptyStreamService.instanceId,
      resolveRoute: options.ptyRuntime.resolveRecoveryRoute,
    })
    await resources.bindingCoordinator.reconcile(resolution.candidates, {
      preserveNodeIds: resolution.unavailableNodeIds,
    })
  }

  const restoreTerminalSession = async ({
    nodeId,
    sessionId,
  }: {
    nodeId: string
    sessionId: string
  }): Promise<boolean> => {
    const resources = await resourcesPromise
    if (!resources) {
      return false
    }
    const record = await resources.repository.read(nodeId)
    if (
      !record?.binding ||
      record.binding.sessionId !== sessionId ||
      record.binding.route.kind !== 'remote'
    ) {
      return false
    }
    const persistedRoute = record.binding.route
    const replayPlan = resolveRemoteTerminalRecoveryReplayPlan(record.checkpoint)
    const archivedDisplayPrefix = composeTerminalRecoveryScrollback({
      ...record,
      checkpoint: null,
      rawTail: '',
      rawTruncated: false,
    })

    const restored = await options.ptyRuntime.restoreRemoteSession({
      homeSessionId: sessionId,
      endpointId: persistedRoute.endpointId,
      remoteSessionId: persistedRoute.remoteSessionId,
      targetWorkerInstanceId: persistedRoute.targetWorkerInstanceId,
      afterSeq: replayPlan.afterSeq,
      beforeAttach: async (runningSession, remotePresentationSnapshot, publishRecoveryBaseline) => {
        try {
          const currentSerializedScreen =
            remotePresentationSnapshot?.serializedScreen ??
            replayPlan.serializedScreenBaseline ??
            ''
          options.ptyStreamService.hub.registerSessionMetadata({
            sessionId,
            kind: 'terminal',
            startedAt: runningSession.startedAt,
            cwd: runningSession.cwd,
            command: runningSession.command,
            args: runningSession.args,
            cols: remotePresentationSnapshot?.cols ?? record.checkpoint?.cols ?? 80,
            rows: remotePresentationSnapshot?.rows ?? record.checkpoint?.rows ?? 24,
          })
          await options.ptyStreamService.hub.restoreSessionPresentationBaseline({
            sessionId,
            serializedScreen: currentSerializedScreen,
            displayPrefix: archivedDisplayPrefix,
          })
          publishRecoveryBaseline()

          const reconciliation = await resources.bindingCoordinator.reconcile([
            {
              nodeId,
              sessionId,
              route: {
                ...persistedRoute,
                homeWorkerInstanceId: options.ptyStreamService.instanceId,
              },
              // An authoritative Remote Hub snapshot is persisted before attach. Fallback replay
              // waits for output to establish a trustworthy cursor before checkpointing.
              checkpointOnBind: remotePresentationSnapshot !== null,
              resetRawTailOnBind:
                remotePresentationSnapshot !== null || replayPlan.resetRawTailOnBind,
            },
          ])
          if (remotePresentationSnapshot !== null) {
            assertAuthoritativeRemoteCheckpointCommitted(
              reconciliation.aligned[0]?.initialCheckpoint ?? null,
            )
          }
        } catch (error) {
          options.ptyStreamService.hub.forgetSession(sessionId)
          await resources.bindingCoordinator.abortBinding({ nodeId, sessionId })
          throw error
        }
      },
    })
    if (!restored || restored.kind !== 'terminal') {
      return false
    }
    if (restored.status !== 'running') {
      // The authoritative final frame is now durable on the old generation. The caller may
      // launch a replacement, whose normal reconciliation will archive that final frame first.
      options.ptyStreamService.hub.forgetSession(sessionId)
      return false
    }
    return true
  }

  const drainBeforeShutdown = async (): Promise<void> => {
    // Freeze new client commands first. Start a checkpoint while runtime output is still observed,
    // but do not await an ever-dirty drain before quiesce establishes the finite output cutoff.
    options.ptyStreamService.freezeIngress()
    await options.ptyStreamService.drainPendingOperations()
    const resources = await resourcesPromise
    const firstFlush = resources
      ? options.ptyStreamService.flushRecovery().catch(() => undefined)
      : null
    await options.ptyStreamService.quiesce()
    if (!resources) {
      return
    }
    await firstFlush

    // Output accepted while the first checkpoint was in flight is now bounded by the cutoff.
    const flushResult = await options.ptyStreamService.flushRecovery().catch(error => ({
      status: 'degraded' as const,
      committed: 0,
      failures: [
        {
          nodeId: 'unknown',
          sessionId: 'unknown',
          reason: 'commit_failed' as const,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    }))
    if (flushResult.status === 'degraded') {
      process.stderr.write(
        `[opencove] terminal recovery shutdown flush degraded: ${JSON.stringify(flushResult.failures)}\n`,
      )
    }
  }

  return {
    onStatePersisted,
    restoreTerminalSession,
    drainBeforeShutdown,
    dispose: async () => {
      const resources = await resourcesPromise
      if (!resources) {
        return
      }
      resources.owner.dispose()
      resources.repository.dispose()
    },
  }
}
