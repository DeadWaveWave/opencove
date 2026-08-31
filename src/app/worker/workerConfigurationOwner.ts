import type {
  HomeWorkerConfigurationSnapshotDto,
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
  WorkerWebAccessRuntimeStatusDto,
} from '../../shared/contracts/dto'
import {
  mutateHomeWorkerConfigFile,
  readHomeWorkerConfigFile,
  toDto,
  type HomeWorkerConfigFile,
  type HomeWorkerConfigModeOptions,
} from '../../contexts/settings/infrastructure/homeWorker/homeWorkerConfig'
import {
  buildHomeWorkerModeConfig,
  buildHomeWorkerWebUiSecurityConfig,
  buildHomeWorkerWebUiSettingsConfig,
} from '../../contexts/settings/infrastructure/homeWorker/homeWorkerConfigMutations'
import type { WorkerWebAccessRuntime, WorkerWebAccessRuntimeStatus } from './workerWebAccessRuntime'

function toWebAccessStatusDto(
  status: WorkerWebAccessRuntimeStatus,
): WorkerWebAccessRuntimeStatusDto {
  if (status.state !== 'active') {
    return { ...status, drainingGenerations: [...status.drainingGenerations] }
  }
  return {
    state: 'active',
    generation: status.generation,
    hostname: status.address.hostname,
    bindHostname: status.address.bindHostname,
    port: status.address.port,
    passwordRequired: status.passwordRequired,
    drainingGenerations: [...status.drainingGenerations],
  }
}

export interface WorkerConfigurationOwner {
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

export function createWorkerConfigurationOwner(options: {
  userDataPath: string
  configOptions?: HomeWorkerConfigModeOptions
  webAccess: WorkerWebAccessRuntime
}): WorkerConfigurationOwner {
  let operationQueue = Promise.resolve()

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationQueue.then(operation)
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const snapshot = (config: HomeWorkerConfigFile): HomeWorkerConfigurationSnapshotDto => ({
    config: toDto(config),
    webAccess: toWebAccessStatusDto(options.webAccess.status()),
  })

  return {
    getSnapshot: async () => {
      await operationQueue
      return snapshot(await readHomeWorkerConfigFile(options.userDataPath, options.configOptions))
    },
    setConfig: input =>
      enqueue(async () => {
        const next = await mutateHomeWorkerConfigFile({
          userDataPath: options.userDataPath,
          configOptions: options.configOptions,
          expectedUpdatedAt: input.expectedUpdatedAt,
          mutate: previous =>
            buildHomeWorkerModeConfig(previous, input.value, options.configOptions),
        })
        return snapshot(next)
      }),
    setWebUiSettings: input =>
      enqueue(async () => {
        const previous = await readHomeWorkerConfigFile(options.userDataPath, options.configOptions)
        const next = buildHomeWorkerWebUiSettingsConfig(previous, input.value)
        const applied = await options.webAccess.apply({
          next,
          expectedUpdatedAt: input.expectedUpdatedAt,
        })
        return snapshot(applied.config)
      }),
    setWebUiSecurity: input =>
      enqueue(async () => {
        const previous = await readHomeWorkerConfigFile(options.userDataPath, options.configOptions)
        const next = await buildHomeWorkerWebUiSecurityConfig(previous, input.value)
        const applied = await options.webAccess.apply({
          next,
          expectedUpdatedAt: input.expectedUpdatedAt,
        })
        return snapshot(applied.config)
      }),
  }
}
