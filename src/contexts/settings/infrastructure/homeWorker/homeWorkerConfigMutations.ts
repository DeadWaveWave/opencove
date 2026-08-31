import { createAppError } from '../../../../shared/errors/appError'
import type {
  HomeWorkerConfigDto,
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
} from '../../../../shared/contracts/dto'
import { hashWebUiPassword } from './webUiPassword'
import {
  isModeSupported,
  isRecord,
  mutateHomeWorkerConfigFile,
  normalizeHomeWorkerMode,
  normalizeOptionalBoolean,
  normalizeOptionalString,
  normalizeRemoteEndpoint,
  toDto,
  type HomeWorkerConfigFile,
  type HomeWorkerConfigModeOptions,
} from './homeWorkerConfig'

export function normalizeHomeWorkerConfigInput(
  input: SetHomeWorkerConfigInput,
  options?: HomeWorkerConfigModeOptions,
): SetHomeWorkerConfigInput {
  if (!isRecord(input)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid home worker config.' })
  }

  const mode = normalizeHomeWorkerMode(input.mode)
  if (!mode) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid home worker mode.' })
  }
  if (!isModeSupported(mode, options)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Home worker mode "${mode}" is disabled in this build.`,
    })
  }

  const remote = normalizeRemoteEndpoint(input.remote)
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
  input: SetHomeWorkerConfigInput,
  options?: HomeWorkerConfigModeOptions,
): HomeWorkerConfigFile {
  const normalized = normalizeHomeWorkerConfigInput(input, options)
  return {
    version: 1,
    mode: normalized.mode,
    remote: normalized.remote,
    webUi: previous.webUi,
    updatedAt: previous.updatedAt,
  }
}

export function normalizeWebUiSettingsInput(value: unknown): {
  enabled: boolean
  port: number | null
} {
  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid home worker web ui settings config.',
    })
  }

  const enabled = normalizeOptionalBoolean(value.enabled)
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
  input: SetHomeWorkerWebUiSettingsInput,
): HomeWorkerConfigFile {
  const { enabled, port } = normalizeWebUiSettingsInput(input)
  return {
    ...previous,
    webUi: { ...previous.webUi, enabled, port },
  }
}

export function normalizeWebUiSecurityInput(
  input: SetHomeWorkerWebUiSecurityInput,
): SetHomeWorkerWebUiSecurityInput {
  if (!isRecord(input)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid home worker web ui security config.',
    })
  }

  const exposeOnLan = normalizeOptionalBoolean(input.exposeOnLan)
  if (exposeOnLan === null) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid exposeOnLan value.' })
  }
  if (
    input.password !== null &&
    (typeof input.password !== 'string' || normalizeOptionalString(input.password) === null)
  ) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid Web UI password.' })
  }
  return {
    exposeOnLan,
    password: normalizeOptionalString(input.password),
  }
}

export async function buildHomeWorkerWebUiSecurityConfig(
  previous: HomeWorkerConfigFile,
  input: SetHomeWorkerWebUiSecurityInput,
): Promise<HomeWorkerConfigFile> {
  const normalized = normalizeWebUiSecurityInput(input)
  const passwordHash = normalized.password
    ? await hashWebUiPassword(normalized.password)
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

export async function setHomeWorkerConfig(
  userDataPath: string,
  input: SetHomeWorkerConfigInput,
  options?: HomeWorkerConfigModeOptions,
): Promise<HomeWorkerConfigDto> {
  return toDto(
    await mutateHomeWorkerConfigFile({
      userDataPath,
      configOptions: options,
      mutate: previous => buildHomeWorkerModeConfig(previous, input, options),
    }),
  )
}

export async function setHomeWorkerWebUiSettings(
  userDataPath: string,
  input: SetHomeWorkerWebUiSettingsInput,
  options?: HomeWorkerConfigModeOptions,
): Promise<HomeWorkerConfigDto> {
  return toDto(
    await mutateHomeWorkerConfigFile({
      userDataPath,
      configOptions: options,
      mutate: previous => buildHomeWorkerWebUiSettingsConfig(previous, input),
    }),
  )
}

export async function setHomeWorkerWebUiSecurity(
  userDataPath: string,
  input: SetHomeWorkerWebUiSecurityInput,
  options?: HomeWorkerConfigModeOptions,
): Promise<HomeWorkerConfigDto> {
  return toDto(
    await mutateHomeWorkerConfigFile({
      userDataPath,
      configOptions: options,
      mutate: async previous => await buildHomeWorkerWebUiSecurityConfig(previous, input),
    }),
  )
}
