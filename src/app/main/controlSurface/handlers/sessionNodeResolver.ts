import { resolveSpaceMountContext } from '../../../../contexts/space/application/resolveSpaceMountContext'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { GetNodeSessionResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import {
  normalizePersistedAgent,
  resolveOwningSpace,
  resolveTerminalRecoveryCwd,
} from './sessionPrepareOrReviveShared'
import { resolveExecutionContextDto } from './sessionLaunchSupport'
import type { SessionRoute } from './sessionRecords'
import {
  isResumeSessionBindingVerified,
  normalizeResumeSessionBinding,
} from '../../../../contexts/agent/domain/agentResumeBinding'

export function createSessionNodeResolver(deps: {
  getPersistenceStore(): Promise<PersistenceStore>
  ptyStreamHub: PtyStreamHub
  ptyRuntime: MultiEndpointPtyRuntime
  topology: WorkerTopologyStore
}) {
  return async (nodeId: string): Promise<{ value: GetNodeSessionResult; route: SessionRoute }> => {
    const state = normalizePersistedAppState(
      await (await deps.getPersistenceStore()).readAppState(),
    )
    const workspace = state?.workspaces.find(item => item.nodes.some(node => node.id === nodeId))
    const node = workspace?.nodes.find(item => item.id === nodeId)
    if (!workspace || !node || !['agent', 'terminal'].includes(node.kind) || !node.sessionId) {
      throw createAppError('session.not_found')
    }
    const route = deps.ptyRuntime.getSessionRoute?.(node.sessionId)
    // Never read a remote conversation from the Home Worker's filesystem.
    if (
      node.workerBinding &&
      node.workerBinding.endpointId !== 'local' &&
      (route?.kind !== 'remote' || route.endpointId !== node.workerBinding.endpointId)
    ) {
      throw createAppError('worker.unavailable')
    }
    if (!route && !node.workerBinding) {
      const space = resolveOwningSpace(workspace, nodeId)
      if (space) {
        const context = resolveSpaceMountContext({
          space,
          workspacePath: workspace.path,
          mounts: (await deps.topology.listMounts({ projectId: workspace.id })).mounts,
        })
        if (context.mount && context.mount.endpointId !== 'local') {
          throw createAppError('worker.unavailable')
        }
      }
    }
    const metadata = deps.ptyStreamHub.getSessionMetadata(node.sessionId)
    const agent = node.kind === 'agent' ? normalizePersistedAgent(node.agent) : null
    const terminalCandidate =
      node.kind === 'terminal' ? normalizeResumeSessionBinding(node.agent) : null
    const terminalBinding =
      terminalCandidate && isResumeSessionBindingVerified(terminalCandidate)
        ? terminalCandidate
        : null
    // Runtime observation wins over a persisted terminal overlay from a previous provider.
    const terminalRun =
      node.kind === 'terminal' ? deps.ptyStreamHub.observeAgentState?.(node.sessionId) : null
    const provider = agent?.provider ?? terminalRun?.provider ?? terminalBinding?.provider ?? null
    const terminalResumeSessionId =
      terminalBinding?.provider === provider ? terminalBinding.resumeSessionId : null
    const cwd =
      agent?.executionDirectory ?? metadata?.cwd ?? resolveTerminalRecoveryCwd(node, workspace.path)
    return {
      route: route ?? { kind: 'local' },
      value: {
        nodeId,
        sessionId: node.sessionId,
        provider,
        startedAt: node.startedAt ?? metadata?.startedAt ?? null,
        cwd,
        prompt: agent?.prompt ?? null,
        model: agent?.model ?? null,
        effectiveModel: agent?.effectiveModel ?? null,
        resumeSessionId: agent?.resumeSessionId ?? terminalResumeSessionId,
        command: metadata?.command ?? null,
        args: metadata?.args ?? null,
        executionContext: resolveExecutionContextDto(cwd, {
          projectId: workspace.id,
          mountId: node.workerBinding?.mountId ?? null,
          ...(route?.kind === 'remote'
            ? {
                endpointId: route.endpointId,
                endpointKind: 'remote_worker',
              }
            : {}),
          spaceId: resolveOwningSpace(workspace, nodeId)?.id ?? null,
        }),
      },
    }
  }
}
