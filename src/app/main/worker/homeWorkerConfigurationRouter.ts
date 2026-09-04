import { createAppError } from '../../../shared/errors/appError'
import type {
  HomeWorkerConfigDto,
  HomeWorkerConfigurationSnapshotDto,
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
  WorkerConnectionInfoDto,
} from '../../../shared/contracts/dto'
import {
  ensureHomeWorkerConfig,
  readHomeWorkerConfig,
  type HomeWorkerConfigModeOptions,
} from '../../../contexts/settings/infrastructure/homeWorker/homeWorkerConfig'
import {
  setHomeWorkerConfig,
  setHomeWorkerWebUiSecurity,
  setHomeWorkerWebUiSettings,
} from '../../../contexts/settings/infrastructure/homeWorker/homeWorkerConfigMutations'
import { invokeLocalWorkerConfiguration } from './localWorkerConfigurationClient'
import { withHomeWorkerConfigLease } from '../../../contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'
import { resolveOwnedLocalWorkerConfigurationState } from './localWorkerManager'

async function readLiveConfig(connection: WorkerConnectionInfoDto) {
  return await invokeLocalWorkerConfiguration(connection, {
    kind: 'query',
    id: 'worker.config.get',
    payload: null,
  })
}

export function createHomeWorkerConfigurationRouter(options: {
  userDataPath: string
  configOptions: HomeWorkerConfigModeOptions
  ensureMissingConfig: boolean
}) {
  const resolveMutationConnection = async (): Promise<WorkerConnectionInfoDto | null> => {
    const owner = await resolveOwnedLocalWorkerConfigurationState()
    if (owner.state === 'unreachable' || owner.state === 'external' || owner.state === 'starting') {
      throw createAppError('worker.unavailable', {
        debugMessage:
          owner.state === 'external'
            ? 'A CLI-managed Worker cannot be reconfigured from Desktop Settings.'
            : owner.state === 'starting'
              ? 'Owned local Worker is still starting its configuration endpoint.'
              : 'Owned local Worker is live but its configuration endpoint is unreachable.',
      })
    }
    return owner.state === 'ready' ? owner.connection : null
  }
  const mutateLive = async (
    connection: WorkerConnectionInfoDto,
    id: string,
    value: unknown,
  ): Promise<HomeWorkerConfigDto> => {
    const current = await readLiveConfig(connection)
    return (
      await invokeLocalWorkerConfiguration(connection, {
        kind: 'command',
        id,
        payload: { value, expectedUpdatedAt: current.config.updatedAt },
      })
    ).config
  }

  const mutateThroughCurrentOwner = async (
    mutateLiveOwner: (connection: WorkerConnectionInfoDto) => Promise<HomeWorkerConfigDto>,
    mutateOffline: () => Promise<HomeWorkerConfigDto>,
  ): Promise<HomeWorkerConfigDto> => {
    const connection = await resolveMutationConnection()
    if (connection) {
      return await mutateLiveOwner(connection)
    }
    return await withHomeWorkerConfigLease(options.userDataPath, async () => {
      const ownerConnection = await resolveMutationConnection()
      return ownerConnection ? await mutateLiveOwner(ownerConnection) : await mutateOffline()
    })
  }

  const readStoredConfig = async (): Promise<HomeWorkerConfigDto> =>
    options.ensureMissingConfig
      ? await ensureHomeWorkerConfig(options.userDataPath, options.configOptions)
      : await readHomeWorkerConfig(options.userDataPath, options.configOptions)
  const readSnapshot = async (): Promise<HomeWorkerConfigurationSnapshotDto> => {
    const owner = await resolveOwnedLocalWorkerConfigurationState()
    if (owner.state === 'ready') {
      return await readLiveConfig(owner.connection)
    }
    return {
      config: await readStoredConfig(),
      webAccess: { state: 'disabled', generation: 0, drainingGenerations: [] },
    }
  }

  return {
    read: async (): Promise<HomeWorkerConfigDto> => (await readSnapshot()).config,
    readSnapshot,
    setConfig: async (value: SetHomeWorkerConfigInput): Promise<HomeWorkerConfigDto> =>
      await mutateThroughCurrentOwner(
        async connection => await mutateLive(connection, 'worker.config.set', value),
        async () => await setHomeWorkerConfig(options.userDataPath, value, options.configOptions),
      ),
    setWebUiSettings: async (
      value: SetHomeWorkerWebUiSettingsInput,
    ): Promise<HomeWorkerConfigDto> =>
      await mutateThroughCurrentOwner(
        async connection => await mutateLive(connection, 'worker.webAccess.setSettings', value),
        async () =>
          await setHomeWorkerWebUiSettings(options.userDataPath, value, options.configOptions),
      ),
    setWebUiSecurity: async (
      value: SetHomeWorkerWebUiSecurityInput,
    ): Promise<HomeWorkerConfigDto> =>
      await mutateThroughCurrentOwner(
        async connection => await mutateLive(connection, 'worker.webAccess.setSecurity', value),
        async () =>
          await setHomeWorkerWebUiSecurity(options.userDataPath, value, options.configOptions),
      ),
  }
}
