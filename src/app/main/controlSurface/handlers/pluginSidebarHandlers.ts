import type { PluginInstallationManager } from '@contexts/plugins/application/PluginInstallationManager'
import { pluginRecord, pluginString } from '@contexts/plugins/domain/localPluginValidation'
import { normalizePluginSidebarItems } from '@contexts/plugins/domain/pluginSidebar'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'

export function registerPluginSidebarHandlers(
  control: ControlSurface,
  deps: { plugins: PluginInstallationManager; getPersistenceStore(): Promise<PersistenceStore> },
): void {
  const fail = (cause: unknown): never => {
    const reason = (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000)
    throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
  }
  control.register('plugin.sidebar.items', {
    kind: 'query',
    validate: value => {
      const raw = pluginRecord(value)
      if (
        Object.keys(raw).some(
          key =>
            ![
              'pluginId',
              'sectionId',
              'projectId',
              'expectedRevision',
              'expectedRuntimeGeneration',
            ].includes(key),
        )
      ) {
        throw new Error('Invalid plugin Sidebar request.')
      }
      if (!Number.isSafeInteger(raw.expectedRuntimeGeneration)) {
        throw new Error('Plugin generation is required.')
      }
      return {
        pluginId: pluginString(raw.pluginId, 'id', 80),
        sectionId: pluginString(raw.sectionId, 'sectionId', 80),
        projectId: pluginString(raw.projectId, 'projectId', 200),
        expectedRevision: pluginString(raw.expectedRevision, 'revision', 200),
        expectedRuntimeGeneration: raw.expectedRuntimeGeneration,
      }
    },
    handle: async (_ctx, input) => {
      try {
        const current = async () => {
          const plugin = (await deps.plugins.list()).find(item => item.id === input.pluginId)
          if (
            !plugin ||
            plugin.enabled === false ||
            plugin.status !== 'ready' ||
            plugin.revision !== input.expectedRevision ||
            plugin.runtimeGeneration !== input.expectedRuntimeGeneration
          ) {
            throw new Error('Plugin changed. Reopen the Sidebar section.')
          }
          const store = await deps.getPersistenceStore()
          const state = normalizePersistedAppState(await store.readAppState())
          if (!state?.workspaces.some(project => project.id === input.projectId)) {
            throw new Error('Sidebar project is no longer available.')
          }
          return plugin
        }
        const plugin = await current()
        const section = plugin.sidebar?.find(item => item.id === input.sectionId)
        if (!section) {
          throw new Error('Plugin Sidebar section is not declared.')
        }
        const value = await deps.plugins.runCommand(
          input.pluginId,
          section.itemsCommand,
          { projectId: input.projectId },
          { context: { surface: 'sidebar', projectId: input.projectId } },
          plugin,
        )
        await current()
        return { items: normalizePluginSidebarItems(value, plugin.commands ?? []) }
      } catch (cause) {
        return fail(cause)
      }
    },
    defaultErrorCode: 'plugin.operation_failed',
  })
}
