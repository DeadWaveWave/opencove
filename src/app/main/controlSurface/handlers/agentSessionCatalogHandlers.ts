import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { listAgentSessions } from '../../../../contexts/agent/infrastructure/cli/AgentSessionCatalog'
import { normalizeListSessionsPayload } from '../../../../contexts/agent/presentation/main-ipc/validate'
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
  controlSurface.register('agent.listSessions', {
    kind: 'query',
    validate: normalizeListSessionsPayload,
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
