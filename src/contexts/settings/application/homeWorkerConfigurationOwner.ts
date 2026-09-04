import type {
  HomeWorkerConfigurationFailureDetailsDto,
  HomeWorkerConfigurationSnapshotDto,
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
  WorkerWebAccessRuntimeStatusDto,
} from '@shared/contracts/dto'
import type { HomeWorkerConfigFile, HomeWorkerConfigModeOptions } from '../domain/homeWorkerConfig'
import {
  buildHomeWorkerModeConfig,
  buildHomeWorkerWebUiSecurityConfig,
  buildHomeWorkerWebUiSettingsConfig,
  type HashHomeWorkerWebUiPassword,
} from './homeWorkerConfigurationPolicy'
import { createSerialOperationQueue } from '@shared/runtime/serialOperationQueue'
import { createAppError, toAppErrorDescriptor } from '@shared/errors/appError'
import type {
  WorkerWebAccessRuntime,
  WorkerWebAccessRuntimeStatus,
} from './workerWebAccess/workerWebAccessTypes'

function toWebAccessStatusDto(
  status: WorkerWebAccessRuntimeStatus,
): WorkerWebAccessRuntimeStatusDto {
  if (status.state !== 'active' && status.state !== 'degraded') {
    return { ...status, drainingGenerations: [...status.drainingGenerations] }
  }
  const common = {
    generation: status.generation,
    hostname: status.address.hostname,
    bindHostname: status.address.bindHostname,
    port: status.address.port,
    passwordRequired: status.passwordRequired,
    drainingGenerations: [...status.drainingGenerations],
  }
  return status.state === 'degraded'
    ? { state: 'degraded', ...common, error: status.error }
    : { state: 'active', ...common }
}

export interface HomeWorkerConfigurationOwner {
  getSnapshot: () => Promise<HomeWorkerConfigurationSnapshotDto>
  setConfig: (input: {
    value: SetHomeWorkerConfigInput
    expectedUpdatedAt: string | null
  }) => Promise<HomeWorkerConfigurationSnapshotDto>
  setWebUiSettings: (input: {
    value: SetHomeWorkerWebUiSettingsInput
    expectedUpdatedAt: string | null
  }) => Promise<HomeWorkerConfigurationSnapshotDto>
  setWebUiSecurity: (input: {
    value: SetHomeWorkerWebUiSecurityInput
    expectedUpdatedAt: string | null
  }) => Promise<HomeWorkerConfigurationSnapshotDto>
}

export function createHomeWorkerConfigurationOwner(options: {
  webAccess: WorkerWebAccessRuntime
  readConfig: () => Promise<HomeWorkerConfigFile>
  mutateConfig: (input: {
    expectedUpdatedAt: string | null
    mutate: (previous: HomeWorkerConfigFile) => HomeWorkerConfigFile | Promise<HomeWorkerConfigFile>
  }) => Promise<HomeWorkerConfigFile>
  toDto: (config: HomeWorkerConfigFile) => HomeWorkerConfigurationSnapshotDto['config']
  configModeOptions?: HomeWorkerConfigModeOptions
  hashWebUiPassword: HashHomeWorkerWebUiPassword
}): HomeWorkerConfigurationOwner {
  const operations = createSerialOperationQueue()

  const snapshot = (config: HomeWorkerConfigFile): HomeWorkerConfigurationSnapshotDto => ({
    config: options.toDto(config),
    webAccess: toWebAccessStatusDto(options.webAccess.status()),
  })
  const mutationFailure = async (
    error: unknown,
    fallbackConfig: HomeWorkerConfigFile,
  ): Promise<Error> => {
    const currentConfig = await options.readConfig().catch(() => fallbackConfig)
    const descriptor = toAppErrorDescriptor(error, 'worker.unavailable')
    const details: HomeWorkerConfigurationFailureDetailsDto = {
      configurationSnapshot: snapshot(currentConfig),
    }
    return createAppError({ ...descriptor, details })
  }

  return {
    getSnapshot: () => operations.run(async () => snapshot(await options.readConfig())),
    setConfig: input =>
      operations.run(async () => {
        const next = await options.mutateConfig({
          expectedUpdatedAt: input.expectedUpdatedAt,
          mutate: previous =>
            buildHomeWorkerModeConfig(previous, input.value, options.configModeOptions),
        })
        return snapshot(next)
      }),
    setWebUiSettings: input =>
      operations.run(async () => {
        const previous = await options.readConfig()
        try {
          const next = buildHomeWorkerWebUiSettingsConfig(previous, input.value)
          const applied = await options.webAccess.apply({
            next,
            expectedUpdatedAt: input.expectedUpdatedAt,
          })
          return snapshot(applied.config)
        } catch (error) {
          throw await mutationFailure(error, previous)
        }
      }),
    setWebUiSecurity: input =>
      operations.run(async () => {
        const previous = await options.readConfig()
        try {
          const next = await buildHomeWorkerWebUiSecurityConfig(
            previous,
            input.value,
            options.hashWebUiPassword,
          )
          const applied = await options.webAccess.apply({
            next,
            expectedUpdatedAt: input.expectedUpdatedAt,
          })
          return snapshot(applied.config)
        } catch (error) {
          throw await mutationFailure(error, previous)
        }
      }),
  }
}
