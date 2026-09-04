import { createHomeWorkerConfigurationOwner } from '../../contexts/settings/application/homeWorkerConfigurationOwner'
import {
  mutateHomeWorkerConfigFile,
  readHomeWorkerConfigFile,
  toDto,
  type HomeWorkerConfigModeOptions,
} from '../../contexts/settings/infrastructure/homeWorker/homeWorkerConfig'
import { hashWebUiPassword } from '../../contexts/settings/infrastructure/homeWorker/webUiPassword'
import type { WorkerWebAccessRuntime } from './workerWebAccessRuntime'

export type { HomeWorkerConfigurationOwner as WorkerConfigurationOwner } from '../../contexts/settings/application/homeWorkerConfigurationOwner'

export function createWorkerConfigurationOwner(options: {
  userDataPath: string
  configOptions?: HomeWorkerConfigModeOptions
  webAccess: WorkerWebAccessRuntime
}): ReturnType<typeof createHomeWorkerConfigurationOwner> {
  return createHomeWorkerConfigurationOwner({
    webAccess: options.webAccess,
    readConfig: async () =>
      await readHomeWorkerConfigFile(options.userDataPath, options.configOptions),
    mutateConfig: async input =>
      await mutateHomeWorkerConfigFile({
        userDataPath: options.userDataPath,
        configOptions: options.configOptions,
        expectedUpdatedAt: input.expectedUpdatedAt,
        mutate: input.mutate,
      }),
    toDto,
    configModeOptions: options.configOptions,
    hashWebUiPassword,
  })
}
