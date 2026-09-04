import { createAppError } from '@shared/errors/appError'
import type {
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
} from '@shared/contracts/dto'
import {
  isHomeWorkerConfigRecord,
  isHomeWorkerModeSupported,
  normalizeHomeWorkerMode,
  normalizeHomeWorkerOptionalBoolean,
  normalizeHomeWorkerOptionalString,
  normalizeHomeWorkerRemoteEndpoint,
  type HomeWorkerConfigFile,
  type HomeWorkerConfigModeOptions,
} from '../domain/homeWorkerConfig'

export type HashHomeWorkerWebUiPassword = (password: string) => Promise<string>

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

export function buildHomeWorkerModeConfig(
  previous: HomeWorkerConfigFile,
  input: unknown,
  options?: HomeWorkerConfigModeOptions,
): HomeWorkerConfigFile {
  const normalized = normalizeHomeWorkerConfigInput(input, options)
  return { ...previous, mode: normalized.mode, remote: normalized.remote }
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

export function buildHomeWorkerWebUiSettingsConfig(
  previous: HomeWorkerConfigFile,
  input: unknown,
): HomeWorkerConfigFile {
  const { enabled, port } = normalizeHomeWorkerWebUiSettingsInput(input)
  return { ...previous, webUi: { ...previous.webUi, enabled, port } }
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

export async function buildHomeWorkerWebUiSecurityConfig(
  previous: HomeWorkerConfigFile,
  input: unknown,
  hashPassword: HashHomeWorkerWebUiPassword,
): Promise<HomeWorkerConfigFile> {
  const normalized = normalizeHomeWorkerWebUiSecurityInput(input)
  const passwordHash = normalized.password
    ? await hashPassword(normalized.password)
    : previous.webUi.passwordHash
  if (normalized.exposeOnLan && passwordHash === null) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Enabling LAN Web UI requires a password.',
    })
  }
  return {
    ...previous,
    webUi: { ...previous.webUi, exposeOnLan: normalized.exposeOnLan, passwordHash },
  }
}
