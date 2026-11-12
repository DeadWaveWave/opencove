import {
  normalizeHomeWorkerConfigInput,
  normalizeHomeWorkerWebUiSecurityInput,
  normalizeHomeWorkerWebUiSettingsInput,
} from '../../../shared/contracts/homeWorkerConfigurationInput'
import { createAppError } from '@shared/errors/appError'
import {
  type HomeWorkerConfigFile,
  type HomeWorkerConfigModeOptions,
} from '../domain/homeWorkerConfig'

export type HashHomeWorkerWebUiPassword = (password: string) => Promise<string>

export function buildHomeWorkerModeConfig(
  previous: HomeWorkerConfigFile,
  input: unknown,
  options?: HomeWorkerConfigModeOptions,
): HomeWorkerConfigFile {
  const normalized = normalizeHomeWorkerConfigInput(input, options)
  return { ...previous, mode: normalized.mode, remote: normalized.remote }
}

export function buildHomeWorkerWebUiSettingsConfig(
  previous: HomeWorkerConfigFile,
  input: unknown,
): HomeWorkerConfigFile {
  const { enabled, port } = normalizeHomeWorkerWebUiSettingsInput(input)
  return { ...previous, webUi: { ...previous.webUi, enabled, port } }
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

export {
  normalizeHomeWorkerConfigInput,
  normalizeHomeWorkerWebUiSecurityInput,
  normalizeHomeWorkerWebUiSettingsInput,
} from '../../../shared/contracts/homeWorkerConfigurationInput'
