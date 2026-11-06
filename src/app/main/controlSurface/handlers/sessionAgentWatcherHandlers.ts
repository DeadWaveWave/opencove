import { registerOperation } from '../registerOperation'
import {
  sessionAttachAgentStateWatcherOperation,
  sessionDetachAgentStateWatcherOperation,
} from '@shared/contracts/controlSurface/operations/domains/session'
import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { shouldStartAgentSessionStateWatcher } from './sessionStateWatcherStart'

export function registerSessionAgentWatcherHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    ptyRuntime: MultiEndpointPtyRuntime
    ptyStreamHub: PtyStreamHub
  },
): void {
  registerOperation(controlSurface, sessionAttachAgentStateWatcherOperation, {
    handle: async (_ctx, payload): Promise<void> => {
      if (!deps.ptyStreamHub.hasSession(payload.sessionId)) {
        throw createAppError('session.not_found', {
          debugMessage: `session.attachAgentStateWatcher: unknown session id: ${payload.sessionId}`,
        })
      }
      if (!(await deps.approvedWorkspaces.isPathApproved(payload.cwd))) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'session.attachAgentStateWatcher cwd is outside approved roots',
        })
      }
      if (
        payload.provider === 'pi' &&
        deps.ptyStreamHub.hasNativePiObservation(payload.sessionId)
      ) {
        return
      }
      if (shouldStartAgentSessionStateWatcher()) {
        deps.ptyRuntime.startSessionStateWatcher?.(payload)
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, sessionDetachAgentStateWatcherOperation, {
    handle: async (_ctx, payload): Promise<void> => {
      deps.ptyRuntime.disposeSessionStateWatcher?.(payload.sessionId)
    },
    defaultErrorCode: 'common.unexpected',
  })
}
