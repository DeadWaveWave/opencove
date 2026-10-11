import { registerPluginSidebarHandlers } from './pluginSidebarHandlers'
import { normalizePluginHostContext } from '@contexts/plugins/domain/pluginCommandContext'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceHandler } from '../types'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { PluginInstallationManager } from '@contexts/plugins/application/PluginInstallationManager'
import { pluginRecord, pluginString } from '@contexts/plugins/domain/localPluginValidation'
import { pluginJsonValue } from '@contexts/plugins/domain/pluginJsonValue'
import {
  listPluginWindows,
  planPluginWindowOpen,
  resolvePluginWindow,
  type PluginWindowInput,
} from '@contexts/workspace/application/nodeControl/pluginWindows'
import { requireNodeControlState } from '@contexts/workspace/application/nodeControl/nodeControlState'
import { projectPluginWindowTitles } from '@contexts/workspace/application/nodeControl/pluginWindowTitles'
import type { SyncEventPayload } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  return record[key] === undefined ? undefined : pluginString(record[key], key, 200)
}
function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  const raw = pluginRecord(value)
  const unexpected = Object.keys(raw).find(key => !allowed.includes(key))
  if (unexpected) {
    throw new Error(`Unsupported plugin argument: ${unexpected}.`)
  }
  return raw
}
function windowInput(value: unknown, operation: 'open' | 'list' | 'run'): PluginWindowInput {
  const raw = fields(value, [
    'pluginId',
    'projectId',
    ...(operation === 'open' ? ['nodeId', 'spaceId', 'anchor'] : []),
    ...(operation === 'run'
      ? [
          'nodeId',
          'viewId',
          'commandId',
          'params',
          'context',
          'expectedRevision',
          'expectedRuntimeGeneration',
        ]
      : []),
  ])
  if (raw.nodeId !== undefined && (raw.spaceId !== undefined || raw.anchor !== undefined)) {
    throw new Error('Placement arguments cannot be combined with an existing --node.')
  }
  let anchor: PluginWindowInput['anchor']
  if (raw.anchor !== undefined) {
    const point = pluginRecord(raw.anchor)
    if (
      typeof point.x !== 'number' ||
      !Number.isFinite(point.x) ||
      typeof point.y !== 'number' ||
      !Number.isFinite(point.y)
    ) {
      throw new Error('Plugin window anchor must contain finite coordinates.')
    }
    anchor = { x: point.x, y: point.y }
  }
  return {
    pluginId: pluginString(raw.pluginId, 'id', 80),
    nodeId: optionalString(raw, 'nodeId'),
    projectId: optionalString(raw, 'projectId'),
    spaceId: optionalString(raw, 'spaceId'),
    anchor,
  }
}

export function registerPluginCommandHandlers(
  control: ControlSurface,
  deps: {
    plugins: PluginInstallationManager
    getPersistenceStore: () => Promise<PersistenceStore>
    publishSyncEvent?: (payload: SyncEventPayload) => number
  },
): void {
  registerPluginSidebarHandlers(control, deps)
  let mutations: Promise<unknown> = Promise.resolve()
  const register = <T, R>(
    id: string,
    kind: 'query' | 'command',
    validate: (value: unknown) => T,
    handle: ControlSurfaceHandler<T, R>['handle'],
  ) => {
    const fail = (error: unknown): never => {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
      throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
    }
    control.register(id, {
      kind,
      validate: value => {
        try {
          return validate(value)
        } catch (error) {
          return fail(error)
        }
      },
      handle: async (ctx, input) => {
        try {
          return await handle(ctx, input)
        } catch (error) {
          return fail(error)
        }
      },
      defaultErrorCode: 'plugin.operation_failed',
    })
  }
  const readState = async () => {
    const store = await deps.getPersistenceStore()
    return windowState(await store.readAppState())
  }
  const windowState = (raw: unknown) => {
    const state = normalizePersistedAppState(raw)
    if (!state) {
      throw new Error('No project is available. Create a project, then select it with --project.')
    }
    return requireNodeControlState(state)
  }
  const plugin = async (id: string) => {
    const entry = (await deps.plugins.list()).find(item => item.id === id)
    if (!entry) {
      throw new Error('Plugin is not independently installed.')
    }
    if (!entry.enabled || entry.status !== 'ready') {
      throw new Error(entry.error ?? 'Plugin is disabled.')
    }
    return entry
  }
  const focus = (
    window: { nodeId: string; projectId: string; spaceId: string | null },
    revision: number,
  ): number =>
    deps.publishSyncEvent?.({
      type: 'canvas.focus',
      revision,
      projectId: window.projectId,
      target: { kind: 'node', nodeId: window.nodeId, spaceId: window.spaceId },
      createdAt: new Date().toISOString(),
    }) ?? 0
  const open = (input: PluginWindowInput) => {
    const task = mutations.then(async () => {
      const manifest = await plugin(input.pluginId)
      const store = await deps.getPersistenceStore()
      // Retry only a pure state plan after a CAS conflict, never a plugin command.
      /* eslint-disable no-await-in-loop -- Each CAS attempt needs the previous write result. */
      for (let attempt = 0; attempt < 3; attempt++) {
        const revision = await store.readAppStateRevision()
        const state = windowState(await store.readAppState())
        const current = await plugin(input.pluginId)
        if (
          current.revision !== manifest.revision ||
          current.runtimeGeneration !== manifest.runtimeGeneration
        ) {
          throw new Error('Plugin changed while opening its window. Please try again.')
        }
        const plan = planPluginWindowOpen(state, manifest, input, new Date().toISOString())
        if (!plan.created) {
          return { ...plan.window, created: false, revision }
        }
        const saved = await store.writeAppState(plan.state, { expectedRevision: revision })
        if (!saved.ok) {
          if (saved.error?.debugMessage?.includes('revision conflict')) {
            continue
          }
          throw createAppError(saved.error)
        }
        const nextRevision = saved.revision ?? (await store.readAppStateRevision())
        deps.publishSyncEvent?.({
          type: 'app_state.updated',
          revision: nextRevision,
          operationId: 'plugin.window.open',
        })
        return { ...plan.window, created: true, revision: nextRevision }
      }
      /* eslint-enable no-await-in-loop */
      throw new Error('The canvas changed while opening the plugin. Please try again.')
    })
    mutations = task.catch(() => undefined)
    return task
  }
  register(
    'plugin.window.open',
    'command',
    value => windowInput(value, 'open'),
    async (_ctx, input) => {
      const result = await open(input)
      return { ...result, deliveredClientCount: focus(result, result.revision) }
    },
  )
  register(
    'plugin.window.list',
    'query',
    value => windowInput(value, 'list'),
    async (_ctx, input) => {
      const store = await deps.getPersistenceStore()
      const state = normalizePersistedAppState(await store.readAppState())
      const windows = state ? listPluginWindows(requireNodeControlState(state), input.pluginId) : []
      const views = await deps.plugins.listViews(input.pluginId)
      return {
        windows: projectPluginWindowTitles(
          windows.filter(item => !input.projectId || item.projectId === input.projectId),
          views,
        ),
      }
    },
  )
  register(
    'plugin.skill.get',
    'query',
    value => {
      const record = fields(value, ['pluginId', 'skillId'])
      return {
        pluginId: pluginString(record.pluginId, 'id', 80),
        skillId: pluginString(record.skillId, 'skillId', 80),
      }
    },
    async (_ctx, input) => deps.plugins.skill(input.pluginId, input.skillId),
  )
  register(
    'plugin.command.run',
    'command',
    value => {
      const raw = pluginRecord(value)
      return {
        ...windowInput(value, 'run'),
        commandId: pluginString(raw.commandId, 'commandId', 80),
        params: pluginJsonValue(raw.params, 1024 * 1024, 'command parameters'),
        viewId: optionalString(raw, 'viewId'),
        context: normalizePluginHostContext(raw.context),
        expectedRevision: optionalString(raw, 'expectedRevision'),
        expectedRuntimeGeneration: raw.expectedRuntimeGeneration,
      }
    },
    async (_ctx, input) => {
      const manifest = await plugin(input.pluginId)
      if (
        (input.expectedRevision !== undefined && input.expectedRevision !== manifest.revision) ||
        (input.expectedRuntimeGeneration !== undefined &&
          input.expectedRuntimeGeneration !== manifest.runtimeGeneration)
      ) {
        throw new Error('Plugin changed before command dispatch; open the menu again.')
      }
      if (input.context?.projectId) {
        const state = await readState()
        const project = state.workspaces.find(item => item.id === input.context!.projectId)
        if (
          !project ||
          (input.context.spaceId &&
            !project.spaces.some(item => item.id === input.context!.spaceId)) ||
          input.context.nodeIds?.some(id => !project.nodes.some(node => node.id === id))
        ) {
          throw new Error('Plugin command context is no longer available.')
        }
      }
      const command = manifest.commands?.find(item => item.id === input.commandId)
      if (!command) {
        throw new Error('Plugin command is not declared.')
      }
      if (input.context && !(command.menus ?? ['commandCenter']).includes(input.context.surface)) {
        throw new Error('Plugin command is not declared for this menu.')
      }
      if (command.target === 'plugin') {
        if (input.projectId || input.nodeId || input.viewId) {
          throw new Error('Plugin-wide commands do not accept --project, --node or --view.')
        }
        return await deps.plugins.runCommand(
          input.pluginId,
          input.commandId,
          input.params,
          {
            nodeId: input.nodeId,
            viewId: input.viewId,
            context: input.context,
          },
          manifest,
        )
      }
      const selected = resolvePluginWindow(await readState(), manifest, input, 'command')
      if (input.viewId) {
        const view = (await deps.plugins.listViews(input.pluginId)).find(
          item => item.viewId === input.viewId && item.nodeId === selected?.nodeId && item.ready,
        )
        if (!view) {
          throw new Error('The selected plugin view is no longer ready. List windows again.')
        }
      }
      if (input.context) {
        const currentTarget = resolvePluginWindow(await readState(), manifest, input, 'command')
        if (
          currentTarget &&
          (input.context.projectId !== currentTarget.projectId ||
            (input.context.surface === 'space' &&
              input.context.spaceId !== currentTarget.spaceId) ||
            (input.context.surface === 'node' &&
              !input.context.nodeIds?.includes(currentTarget.nodeId)))
        ) {
          throw new Error('Plugin window target does not belong to the selected context.')
        }
        if (!currentTarget || !input.nodeId || !input.viewId) {
          throw new Error('Menu commands require an explicit ready node and view.')
        }
        return await deps.plugins.runCommand(
          input.pluginId,
          input.commandId,
          input.params,
          {
            nodeId: currentTarget.nodeId,
            viewId: input.viewId,
            context: input.context,
          },
          manifest,
        )
      }
      const target = selected ?? (await open(input))
      const ready = async () =>
        (await deps.plugins.listViews(input.pluginId)).filter(
          view =>
            view.nodeId === target.nodeId &&
            view.ready &&
            (!input.viewId || view.viewId === input.viewId),
        )
      if (!(await ready()).length) {
        const store = await deps.getPersistenceStore()
        if (!focus(target, await store.readAppStateRevision())) {
          throw new Error('A Desktop or Web UI must be connected to open this plugin window.')
        }
        const deadline = Date.now() + 10_000
        /* eslint-disable no-await-in-loop -- Poll one view readiness until its bounded deadline. */
        while (!(await ready()).length && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        /* eslint-enable no-await-in-loop */
      }
      const finalState = await readState()
      const current = await plugin(input.pluginId)
      if (
        current.revision !== manifest.revision ||
        current.runtimeGeneration !== manifest.runtimeGeneration
      ) {
        throw new Error('Plugin changed before command dispatch; the command was not run.')
      }
      resolvePluginWindow(
        finalState,
        current,
        { ...input, nodeId: target.nodeId, projectId: target.projectId },
        'command',
      )
      return await deps.plugins.runCommand(
        input.pluginId,
        input.commandId,
        input.params,
        {
          nodeId: target.nodeId,
          viewId: input.viewId,
        },
        manifest,
      )
    },
  )
}
