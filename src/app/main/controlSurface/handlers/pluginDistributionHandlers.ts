import type { ControlSurface } from '../controlSurface'
import type { PluginDistributionService } from '@contexts/plugins/application/PluginDistributionService'
import { createAppError } from '@shared/errors/appError'
import {
  distributionFields,
  gitInstallInput,
  pluginGitRef,
} from '@contexts/plugins/domain/pluginDistributionValidation'
import { pluginString } from '@contexts/plugins/domain/localPluginValidation'

export function registerPluginDistributionHandlers(
  surface: ControlSurface,
  service: PluginDistributionService,
): void {
  const fail = (error: unknown): never => {
    const reason = String(error instanceof Error ? error.message : error).slice(0, 2000)
    throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
  }
  const register = <T>(
    id: string,
    kind: 'query' | 'command',
    validate: (value: unknown) => T,
    handle: (value: T) => Promise<unknown>,
  ) =>
    surface.register(id, {
      kind,
      validate: value => {
        try {
          return validate(value)
        } catch (error) {
          return fail(error)
        }
      },
      handle: async (_ctx, value) => {
        try {
          return await handle(value)
        } catch (error) {
          return fail(error)
        }
      },
      defaultErrorCode: 'common.invalid_input',
    })
  const id = (value: unknown) => {
    const record = distributionFields(value, ['pluginId'])
    return pluginString(record.pluginId, 'id', 80)
  }
  const update = (value: unknown) => {
    const record = distributionFields(value, ['pluginId', 'ref'])
    return {
      pluginId: pluginString(record.pluginId, 'id', 80),
      ref: record.ref === undefined ? undefined : pluginGitRef(record.ref),
    }
  }
  register('plugin.git.install', 'command', gitInstallInput, value => service.install(value))
  register('plugin.source', 'query', id, value => service.inspect(value))
  register('plugin.git.check', 'command', update, value => service.check(value.pluginId, value.ref))
  register('plugin.git.update', 'command', update, value =>
    service.update(value.pluginId, value.ref),
  )
  register(
    'plugin.git.apply',
    'command',
    value =>
      pluginString(distributionFields(value, ['candidateId']).candidateId, 'candidate id', 80),
    value => service.apply(value),
  )
  register(
    'plugin.rollback',
    'command',
    value => {
      const record = distributionFields(value, ['pluginId', 'revision'])
      return {
        pluginId: pluginString(record.pluginId, 'id', 80),
        revision: pluginString(record.revision, 'revision', 64),
      }
    },
    value => service.rollback(value.pluginId, value.revision),
  )
  register(
    'plugin.repository.details',
    'query',
    value => pluginString(distributionFields(value, ['repository']).repository, 'repository', 2000),
    value => service.repositoryDetails(value),
  )
  register(
    'plugin.discover',
    'query',
    value => {
      const record = distributionFields(value ?? {}, ['query'])
      return record.query === undefined || record.query === ''
        ? ''
        : pluginString(record.query, 'search', 200)
    },
    value => service.discover(value),
  )
}
