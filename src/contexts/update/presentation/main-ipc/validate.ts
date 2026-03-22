import {
  APP_UPDATE_CHANNELS,
  APP_UPDATE_POLICIES,
  type AppUpdateChannel,
  type AppUpdatePolicy,
  type ConfigureAppUpdatesInput,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isValidPolicy(value: unknown): value is AppUpdatePolicy {
  return typeof value === 'string' && APP_UPDATE_POLICIES.includes(value as AppUpdatePolicy)
}

function isValidChannel(value: unknown): value is AppUpdateChannel {
  return typeof value === 'string' && APP_UPDATE_CHANNELS.includes(value as AppUpdateChannel)
}

export function normalizeConfigureAppUpdatesPayload(payload: unknown): ConfigureAppUpdatesInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'app-update:configure payload must be an object',
    })
  }

  const { policy, channel } = payload
  if (!isValidPolicy(policy) || !isValidChannel(channel)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'app-update:configure payload is missing a valid policy/channel',
    })
  }

  return { policy, channel }
}
