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

export function registerSessionPrepareOrReviveHandler(
  controlSurface: ControlSurface,
  deps: {
    getPersistenceStore: () => Promise<PersistenceStore>
    ptyStreamHub: PtyStreamHub
  },
): void {
  controlSurface.register('session.prepareOrRevive', {
    kind: 'command',
    validate: normalizeWorkspaceIdPayload,
    handle: async (ctx, payload): Promise<PrepareOrReviveSessionResult> => {
      const store = await deps.getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())
      const workspace = normalized?.workspaces.find(item => item.id === payload.workspaceId) ?? null
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
      const nodes = await workspace.nodes.reduce<Promise<PreparedRuntimeNodeResult[]>>(
        async (preparedNodesPromise, node) => {
          const preparedNodes = await preparedNodesPromise
          if (node.kind !== 'terminal' && node.kind !== 'agent') {
            return preparedNodes
          }
          if (nodeIdFilter && !nodeIdFilter.has(node.id)) {
            return preparedNodes
          }

          const existingSessionId = normalizeOptionalString(node.sessionId)
          if (existingSessionId && deps.ptyStreamHub.hasSession(existingSessionId)) {
            const scrollback =
              node.kind === 'agent'
                ? null
                : await resolvePreparedScrollback({
                    store,
                    node,
                  })
            return [
              ...preparedNodes,
              toPreparedNodeResult(node, {
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
              }),
            ]
          }

          const space = resolveOwningSpace(workspace, node.id)

          if (node.kind === 'agent') {
            const agent = normalizePersistedAgent(node.agent)
            if (!agent) {
              return preparedNodes
            }

            return [
              ...preparedNodes,
              await prepareAgentNode({
                controlSurface,
                ctx,
                store,
                workspace,
                node,
                space,
                agent,
                settings,
              }),
            ]
          }

          return [
            ...preparedNodes,
            await prepareTerminalNode({
              controlSurface,
              ctx,
              store,
              workspace,
              node,
              space,
            }),
          ]
        },
        Promise.resolve([]),
      )

      return {
        workspaceId: workspace.id,
        nodes,
      }
    },
    defaultErrorCode: 'common.unexpected',
  })
}
