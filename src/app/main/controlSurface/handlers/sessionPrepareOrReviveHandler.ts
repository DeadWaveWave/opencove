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

const PREPARE_OR_REVIVE_CONCURRENCY = 4

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)))
  const claimNextItem = (): { index: number; item: T } | null => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      const item = items[index]
      if (item !== undefined) {
        return { index, item }
      }
    }

    return null
  }
  const runWorker = async (): Promise<void> => {
    const nextItem = claimNextItem()
    if (!nextItem) {
      return
    }

    results[nextItem.index] = await mapper(nextItem.item)
    await runWorker()
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

  return results
}

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
      const runtimeNodes = workspace.nodes.filter(node => {
        if (node.kind !== 'terminal' && node.kind !== 'agent') {
          return false
        }

        return !nodeIdFilter || nodeIdFilter.has(node.id)
      })

      const preparedNodes = await mapWithConcurrency(
        runtimeNodes,
        PREPARE_OR_REVIVE_CONCURRENCY,
        async (node): Promise<PreparedRuntimeNodeResult | null> => {
          const existingSessionId = normalizeOptionalString(node.sessionId)
          if (existingSessionId && deps.ptyStreamHub.hasSession(existingSessionId)) {
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
              ctx,
              store,
              workspace,
              node,
              space,
              agent,
              settings,
            })
          }

          return await prepareTerminalNode({
            controlSurface,
            ctx,
            store,
            workspace,
            node,
            space,
          })
        },
      )
      const nodes = preparedNodes.filter((node): node is PreparedRuntimeNodeResult => node !== null)

      return {
        workspaceId: workspace.id,
        nodes,
      }
    },
    defaultErrorCode: 'common.unexpected',
  })
}
