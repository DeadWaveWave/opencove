import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import {
  AGENT_PROVIDER_IDS,
  type AgentProviderId,
  type AttachAgentStateWatcherInput,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { isRecord, normalizeOptionalString } from './sessionLaunchPayloadSupport'
import { shouldStartAgentSessionStateWatcher } from './sessionStateWatcherStart'

function normalizeSessionId(payload: unknown, operationId: string): string {
  if (!isRecord(payload) || typeof payload.sessionId !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  const sessionId = payload.sessionId.trim()
  if (sessionId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} sessionId.`,
    })
  }

  return sessionId
}

function normalizeAttachPayload(payload: unknown): AttachAgentStateWatcherInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.attachAgentStateWatcher.',
    })
  }

  const sessionId = normalizeSessionId(payload, 'session.attachAgentStateWatcher')
  const provider = payload.provider
  const cwd = typeof payload.cwd === 'string' ? payload.cwd.trim() : ''
  const launchMode = payload.launchMode
  const startedAtMs = payload.startedAtMs
  if (
    typeof provider !== 'string' ||
    !AGENT_PROVIDER_IDS.includes(provider as AgentProviderId) ||
    cwd.length === 0 ||
    (launchMode !== 'new' && launchMode !== 'resume') ||
    typeof startedAtMs !== 'number' ||
    !Number.isFinite(startedAtMs) ||
    startedAtMs <= 0
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.attachAgentStateWatcher fields.',
    })
  }

  return {
    sessionId,
    provider: provider as AgentProviderId,
    cwd,
    launchMode,
    resumeSessionId: normalizeOptionalString(payload.resumeSessionId),
    startedAtMs,
  }
}

export function registerSessionAgentWatcherHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    ptyRuntime: MultiEndpointPtyRuntime
    ptyStreamHub: PtyStreamHub
  },
): void {
  controlSurface.register('session.attachAgentStateWatcher', {
    kind: 'command',
    validate: normalizeAttachPayload,
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
      if (shouldStartAgentSessionStateWatcher()) {
        deps.ptyRuntime.startSessionStateWatcher?.(payload)
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('session.detachAgentStateWatcher', {
    kind: 'command',
    validate: payload => ({
      sessionId: normalizeSessionId(payload, 'session.detachAgentStateWatcher'),
    }),
    handle: async (_ctx, payload): Promise<void> => {
      deps.ptyRuntime.disposeSessionStateWatcher?.(payload.sessionId)
    },
    defaultErrorCode: 'common.unexpected',
  })
}
