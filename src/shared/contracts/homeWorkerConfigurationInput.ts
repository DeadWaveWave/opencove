import type {
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
} from '@shared/contracts/dto'
import { createAppError } from '@shared/errors/appError'
import {
  isHomeWorkerConfigRecord,
  isHomeWorkerModeSupported,
  normalizeHomeWorkerMode,
  normalizeHomeWorkerOptionalBoolean,
  normalizeHomeWorkerOptionalString,
  normalizeHomeWorkerRemoteEndpoint,
  type HomeWorkerConfigModeOptions,
} from './homeWorkerConfig'
export function normalizeHomeWorkerConfigInput(
  input: unknown,
  options?: HomeWorkerConfigModeOptions,
): SetHomeWorkerConfigInput {
  if (!isHomeWorkerConfigRecord(input)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid home worker config.' })
  }
  const mode = normalizeHomeWorkerMode(input.mode)
  if (!mode) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid home worker mode.' })
  }
  if (!isHomeWorkerModeSupported(mode, options)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Home worker mode "${mode}" is disabled in this build.`,
    })
  }
  const remote = normalizeHomeWorkerRemoteEndpoint(input.remote)
  if (mode === 'remote' && !remote) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Remote mode requires a remote worker endpoint.',
    })
  }
  if (mode !== 'remote' && remote !== null) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Remote endpoint can only be configured for remote mode.',
    })
  }
  return { mode, remote }
}

export function normalizeHomeWorkerWebUiSettingsInput(
  value: unknown,
): SetHomeWorkerWebUiSettingsInput {
  if (!isHomeWorkerConfigRecord(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid home worker web ui settings config.',
    })
  }
  const enabled = normalizeHomeWorkerOptionalBoolean(value.enabled)
  if (enabled === null) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid web ui enabled value.' })
  }
  const rawPort = value.port
  if (rawPort === null || rawPort === undefined || rawPort === 0) {
    return { enabled, port: null }
  }
  if (
    typeof rawPort !== 'number' ||
    !Number.isFinite(rawPort) ||
    !Number.isInteger(rawPort) ||
    rawPort < 0 ||
    rawPort > 65_535
  ) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid web ui port value.' })
  }
  return { enabled, port: rawPort }
}

export function normalizeHomeWorkerWebUiSecurityInput(
  input: unknown,
): SetHomeWorkerWebUiSecurityInput {
  if (!isHomeWorkerConfigRecord(input)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid home worker web ui security config.',
    })
  }
  const exposeOnLan = normalizeHomeWorkerOptionalBoolean(input.exposeOnLan)
  if (exposeOnLan === null) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid exposeOnLan value.' })
  }
  if (
    input.password !== null &&
    (typeof input.password !== 'string' ||
      normalizeHomeWorkerOptionalString(input.password) === null)
  ) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid Web UI password.' })
  }
  return {
    exposeOnLan,
    password: normalizeHomeWorkerOptionalString(input.password),
  }
}
