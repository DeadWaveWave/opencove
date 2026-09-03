import type {
  HomeWorkerConfigurationSnapshotDto,
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
  WorkerWebAccessRuntimeStatusDto,
} from '@shared/contracts/dto'
import type { HomeWorkerConfigFile } from '../domain/homeWorkerConfig'
import { createSerialOperationQueue } from '@shared/runtime/serialOperationQueue'
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
  buildMode: (
    previous: HomeWorkerConfigFile,
    input: SetHomeWorkerConfigInput,
  ) => HomeWorkerConfigFile
  buildWebUiSettings: (
    previous: HomeWorkerConfigFile,
    input: SetHomeWorkerWebUiSettingsInput,
  ) => HomeWorkerConfigFile
  buildWebUiSecurity: (
    previous: HomeWorkerConfigFile,
    input: SetHomeWorkerWebUiSecurityInput,
  ) => Promise<HomeWorkerConfigFile>
}): HomeWorkerConfigurationOwner {
  const operations = createSerialOperationQueue()

  const snapshot = (config: HomeWorkerConfigFile): HomeWorkerConfigurationSnapshotDto => ({
    config: options.toDto(config),
    webAccess: toWebAccessStatusDto(options.webAccess.status()),
  })

  return {
    getSnapshot: () => operations.run(async () => snapshot(await options.readConfig())),
    setConfig: input =>
      operations.run(async () => {
        const next = await options.mutateConfig({
          expectedUpdatedAt: input.expectedUpdatedAt,
          mutate: previous => options.buildMode(previous, input.value),
        })
        return snapshot(next)
      }),
    setWebUiSettings: input =>
      operations.run(async () => {
        const previous = await options.readConfig()
        const next = options.buildWebUiSettings(previous, input.value)
        const applied = await options.webAccess.apply({
          next,
          expectedUpdatedAt: input.expectedUpdatedAt,
        })
        return snapshot(applied.config)
      }),
    setWebUiSecurity: input =>
      operations.run(async () => {
        const previous = await options.readConfig()
        const next = await options.buildWebUiSecurity(previous, input.value)
        const applied = await options.webAccess.apply({
          next,
          expectedUpdatedAt: input.expectedUpdatedAt,
        })
        return snapshot(applied.config)
      }),
  }
}
