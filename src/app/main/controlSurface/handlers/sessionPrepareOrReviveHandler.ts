import { registerOperation } from '../registerOperation'
import {
  guardLegacyManagedClaudeContext,
  managedClaudeWritesEnabled,
} from '../managedClaudeCompatibility'
import { assertManagedClaudeLaunchCurrent } from '../managedClaudeLaunchRuntime'
import { sessionPrepareOrReviveOperation } from '@shared/contracts/controlSurface/operations/domains/session'
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
  const inFlightNodes = new Map<
    string,
    { operation: Promise<PreparedRuntimeNodeResult | null>; attempt: unknown }
  >()
  const prepareOnce = (
    workspaceId: string,
    nodeId: string,
    prepare: () => Promise<PreparedRuntimeNodeResult | null>,
    attempt: unknown,
  ): Promise<PreparedRuntimeNodeResult | null> => {
    const key = JSON.stringify([workspaceId, nodeId])
    const existing = inFlightNodes.get(key)
    if (existing && existing.attempt === attempt) {
      return existing.operation
    }
    const operation = prepare().finally(() => {
      if (inFlightNodes.get(key)?.operation === operation) {
        inFlightNodes.delete(key)
      }
    })
    inFlightNodes.set(key, { operation, attempt })
    return operation
  }
  registerOperation(controlSurface, sessionPrepareOrReviveOperation, {
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
                  await ctx.managedClaudePreparation?.awaitPending(node.id)
                  ctx.assertActive?.()
                  const observed = store.observeManagedClaudeNode?.(node.id)
                  if (observed?.retired) {
                    return null
                  }
                  const existingSessionId = normalizeOptionalString(
                    observed?.binding ? observed.nodeRuntimeSessionId : node.sessionId,
                  )
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
                    const final = store.observeManagedClaudeNode?.(node.id)
                    if (
                      final?.retired ||
                      (final?.binding && final.nodeRuntimeSessionId !== existingSessionId)
                    ) {
                      return null
                    }
                    const binding = final?.binding
                    return toPreparedNodeResult(node, {
                      ...(binding ? { managedClaudeBinding: binding } : {}),
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
                      agent: binding
                        ? { ...normalizePersistedAgent(node.agent)!, ...binding.tuple }
                        : normalizePersistedAgent(node.agent),
                    })
                  }

                  const space = resolveOwningSpace(workspace, node.id)

                  if (node.kind === 'agent') {
                    const agent = normalizePersistedAgent(node.agent)
                    if (!agent) {
                      return null
                    }

                    const attempt =
                      ctx.managedClaudePreparation?.attempts.get(node.id) ??
                      (observed?.binding
                        ? await ctx.managedClaudePreparation?.reserve(node.id)
                        : undefined)
                    const preparationContext = attempt
                      ? {
                          ...recoveryContext,
                          assertActive: () => {
                            recoveryContext.assertActive?.()
                            assertManagedClaudeLaunchCurrent()
                          },
                        }
                      : /* @compat managed-claude-worker-support */ guardLegacyManagedClaudeContext(
                          recoveryContext,
                          store,
                          node.id,
                          managedClaudeWritesEnabled,
                        )
                    const prepare = async () =>
                      await prepareAgentNode({
                        controlSurface,
                        ctx: preparationContext,
                        store,
                        workspace,
                        node,
                        space,
                        agent,
                        settings,
                        ptyRuntime: deps.ptyRuntime,
                      })
                    return attempt ? ctx.managedClaudePreparation!.run(attempt, prepare) : prepare()
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
                ctx.managedClaudePreparation?.attempts.get(node.id),
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
