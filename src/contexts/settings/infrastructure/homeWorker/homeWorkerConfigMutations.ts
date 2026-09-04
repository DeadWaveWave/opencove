import type {
  HomeWorkerConfigDto,
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
} from '@shared/contracts/dto'
import {
  buildHomeWorkerModeConfig,
  buildHomeWorkerWebUiSecurityConfig,
  buildHomeWorkerWebUiSettingsConfig,
} from '../../application/homeWorkerConfigurationPolicy'
import { hashWebUiPassword } from './webUiPassword'
import {
  mutateHomeWorkerConfigFile,
  toDto,
  type HomeWorkerConfigModeOptions,
} from './homeWorkerConfig'

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
      mutate: async previous =>
        await buildHomeWorkerWebUiSecurityConfig(previous, input, hashWebUiPassword),
    }),
  )
}
