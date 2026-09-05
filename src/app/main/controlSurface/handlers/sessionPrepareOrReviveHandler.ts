import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type {
  PrepareOrReviveSessionResult,
  PreparedRuntimeNodeResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { normalizeAgentSettings } from '../../../../contexts/settings/domain/agentSettings'
import { normalizeOptionalString } from './sessionLaunchPayloadSupport'
import {
  normalizePersistedAppState,
  normalizePersistedAgent,
  normalizeWorkspaceIdPayload,
  resolveNodeProfileId,
  resolvePreparedScrollback,
  resolveNodeRuntimeKind,
  resolveOwningSpace,
  toPreparedNodeResult,
} from './sessionPrepareOrReviveShared'
import { prepareAgentNode, prepareTerminalNode } from './sessionPrepareOrRevivePreparation'
import type { TerminalRecoverySpawnAdmission } from '../../../../contexts/terminal/application/TerminalRuntimeAvailability'
import { mapWithConcurrency } from '../../../../shared/utils/mapWithConcurrency'

const PREPARE_OR_REVIVE_CONCURRENCY = 4

export function registerSessionPrepareOrReviveHandler(
  controlSurface: ControlSurface,
  deps: {
    getPersistenceStore: () => Promise<PersistenceStore>
    ptyStreamHub: PtyStreamHub
    ptyRuntime: Pick<
      import('./sessionPtyRuntime').ControlSurfacePtyRuntime,
      'waitForShellReady' | 'write' | 'onData' | 'onExit' | 'onMetadata' | 'kill'
    >
    restoreTerminalSession?: (input: { nodeId: string; sessionId: string }) => Promise<boolean>
    terminalRecoverySpawnAdmission: TerminalRecoverySpawnAdmission
  },
): void {
  const inFlightNodes = new Map<string, Promise<PreparedRuntimeNodeResult | null>>()
  const prepareOnce = (
    workspaceId: string,
    nodeId: string,
    prepare: () => Promise<PreparedRuntimeNodeResult | null>,
  ): Promise<PreparedRuntimeNodeResult | null> => {
    const key = JSON.stringify([workspaceId, nodeId])
    const existing = inFlightNodes.get(key)
    if (existing) {
      return existing
    }
    const operation = prepare().finally(() => {
      if (inFlightNodes.get(key) === operation) {
        inFlightNodes.delete(key)
      }
    })
    inFlightNodes.set(key, operation)
    return operation
  }
  controlSurface.register('session.prepareOrRevive', {
    kind: 'command',
    validate: normalizeWorkspaceIdPayload,
    handle: async (ctx, payload): Promise<PrepareOrReviveSessionResult> =>
      await deps.terminalRecoverySpawnAdmission.reconcileWorkspace(
        payload.workspaceId,
        async recoveryScope => {
          const recoveryContext = { ...ctx, terminalRecoverySpawnScope: recoveryScope }
          const store = await deps.getPersistenceStore()
          const normalized = normalizePersistedAppState(await store.readAppState())
          const workspace =
            normalized?.workspaces.find(item => item.id === payload.workspaceId) ?? null
          if (!workspace) {
            throw createAppError('common.invalid_input', {
              debugMessage: `session.prepareOrRevive unknown workspaceId: ${payload.workspaceId}`,
            })
          }

          const nodeIdFilter =
            Array.isArray(payload.nodeIds) && payload.nodeIds.length > 0
              ? new Set(payload.nodeIds)
              : null
          const settings = normalizeAgentSettings(normalized?.settings)
          const runtimeNodes = workspace.nodes.filter(node => {
            if (node.kind !== 'terminal' && node.kind !== 'agent') {
              return false
            }

            return !nodeIdFilter || nodeIdFilter.has(node.id)
          })

          const preparedNodes = await mapWithConcurrency(
            runtimeNodes,
            PREPARE_OR_REVIVE_CONCURRENCY,
            node =>
              prepareOnce(
                workspace.id,
                node.id,
                async (): Promise<PreparedRuntimeNodeResult | null> => {
                  const existingSessionId = normalizeOptionalString(node.sessionId)
                  if (
                    existingSessionId &&
                    node.kind === 'terminal' &&
                    !deps.ptyStreamHub.isSessionActive(existingSessionId) &&
                    deps.restoreTerminalSession
                  ) {
                    await deps.restoreTerminalSession({
                      nodeId: node.id,
                      sessionId: existingSessionId,
                    })
                  }
                  if (existingSessionId && deps.ptyStreamHub.isSessionActive(existingSessionId)) {
                    const scrollback =
                      node.kind === 'agent'
                        ? null
                        : await resolvePreparedScrollback({
                            store,
                            node,
                          })
                    return toPreparedNodeResult(node, {
                      recoveryState: 'live',
                      sessionId: existingSessionId,
                      isLiveSessionReattach: true,
                      profileId: resolveNodeProfileId(node),
                      runtimeKind: resolveNodeRuntimeKind(node),
                      status: node.status,
                      startedAt: node.startedAt,
                      endedAt: node.endedAt,
                      exitCode: node.exitCode,
                      lastError: node.lastError,
                      scrollback,
                      executionDirectory: normalizeOptionalString(node.executionDirectory),
                      expectedDirectory: normalizeOptionalString(node.expectedDirectory),
                      agent: normalizePersistedAgent(node.agent),
                    })
                  }

                  const space = resolveOwningSpace(workspace, node.id)

                  if (node.kind === 'agent') {
                    const agent = normalizePersistedAgent(node.agent)
                    if (!agent) {
                      return null
                    }

                    return await prepareAgentNode({
                      controlSurface,
                      ctx: recoveryContext,
                      store,
                      workspace,
                      node,
                      space,
                      agent,
                      settings,
                      ptyRuntime: deps.ptyRuntime,
                    })
                  }

                  return await prepareTerminalNode({
                    controlSurface,
                    ctx: recoveryContext,
                    ptyRuntime: deps.ptyRuntime,
                    store,
                    workspace,
                    node,
                    space,
                  })
                },
              ),
          )
          const nodes = preparedNodes.filter(
            (node): node is PreparedRuntimeNodeResult => node !== null,
          )

          return {
            workspaceId: workspace.id,
            nodes,
          }
        },
      ),
    defaultErrorCode: 'common.unexpected',
  })
}
