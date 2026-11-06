import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { listAgentSessions } from '../../../../contexts/agent/infrastructure/cli/AgentSessionCatalog'
import { registerOperation } from '../registerOperation'
import { agentListSessionsOperation } from '@shared/contracts/controlSurface/operations/domains/agent'
import type {
  ListAgentSessionsInput,
  ListAgentSessionsResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'

export function registerAgentSessionCatalogHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
  },
): void {
  registerOperation(controlSurface, agentListSessionsOperation, {
    handle: async (_ctx, payload: ListAgentSessionsInput): Promise<ListAgentSessionsResult> => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'agent.listSessions cwd is outside approved workspaces',
        })
      }

      return await listAgentSessions(payload)
    },
    defaultErrorCode: 'common.unexpected',
  })
}
