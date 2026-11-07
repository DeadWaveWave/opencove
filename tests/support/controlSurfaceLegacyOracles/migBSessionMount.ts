// Frozen from src/app/main/controlSurface/handlers/sessionLaunchAgentInMountPayload.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; validator bodies verbatim, imports adjusted.
import type { LaunchAgentSessionInMountInput } from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
import { normalizeLaunchAgentEnv } from './sessionLaunchAgentEnv'
import {
  isRecord,
  normalizeAgentProviderId,
  normalizeFileSystemUri,
  normalizeOptionalPositiveInt,
  normalizeOptionalString,
} from './migBMountSupport'

export function normalizeLaunchAgentInMountPayload(
  payload: unknown,
): LaunchAgentSessionInMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount.',
    })
  }

  const mountId = normalizeOptionalString(payload.mountId)
  if (!mountId) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount mountId.',
    })
  }

  const cwdUriRaw = payload.cwdUri
  if (cwdUriRaw !== undefined && cwdUriRaw !== null && typeof cwdUriRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount cwdUri.',
    })
  }

  const promptRaw = payload.prompt
  if (typeof promptRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount prompt.',
    })
  }

  const provider = normalizeAgentProviderId(payload.provider, 'session.launchAgentInMount provider')

  const modelRaw = payload.model
  if (modelRaw !== undefined && modelRaw !== null && typeof modelRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount model.',
    })
  }

  const modeRaw = payload.mode
  if (modeRaw !== undefined && modeRaw !== null && typeof modeRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount mode.',
    })
  }

  const resumeSessionIdRaw = payload.resumeSessionId
  if (
    resumeSessionIdRaw !== undefined &&
    resumeSessionIdRaw !== null &&
    typeof resumeSessionIdRaw !== 'string'
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount resumeSessionId.',
    })
  }

  const agentFullAccess = payload.agentFullAccess
  if (
    agentFullAccess !== undefined &&
    agentFullAccess !== null &&
    typeof agentFullAccess !== 'boolean'
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount agentFullAccess.',
    })
  }

  const env = normalizeLaunchAgentEnv(payload.env)
  const executablePathOverride =
    payload.executablePathOverride === undefined || payload.executablePathOverride === null
      ? null
      : normalizeOptionalString(payload.executablePathOverride)

  return {
    mountId,
    cwdUri:
      cwdUriRaw === undefined || cwdUriRaw === null
        ? null
        : normalizeFileSystemUri(cwdUriRaw, 'session.launchAgentInMount cwdUri'),
    prompt: promptRaw.trim(),
    provider,
    mode: modeRaw === 'resume' ? 'resume' : 'new',
    model: modelRaw === null ? null : normalizeOptionalString(modelRaw),
    resumeSessionId:
      resumeSessionIdRaw === null ? null : normalizeOptionalString(resumeSessionIdRaw),
    env,
    executablePathOverride,
    agentFullAccess: agentFullAccess ?? null,
    cols: normalizeOptionalPositiveInt(payload.cols),
    rows: normalizeOptionalPositiveInt(payload.rows),
  }
}
