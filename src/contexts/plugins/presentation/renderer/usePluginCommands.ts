import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginHostContext, PluginLiveView } from '../../domain/pluginRuntimeTypes'
import type { PluginCommandDeclaration, PluginManifest } from '../../domain/pluginTypes'
import { usePluginRegistry, getPluginManifest } from './usePluginRegistry'
import { publishPluginCommandFeedback } from './pluginCommandFeedback'
import { pluginErrorMessage } from './pluginErrorMessage'

interface WindowTarget {
  nodeId: string
  projectId: string
  spaceId: string | null
  title: string
  views: PluginLiveView[]
}
export interface HostPluginCommand {
  id: string
  title: string
  plugin: PluginManifest
  command: PluginCommandDeclaration
  target?: { nodeId: string; viewId: string; projectId: string }
}
export function usePluginCommands(context: PluginHostContext, active = true) {
  const { plugins } = usePluginRegistry()
  const { t } = useTranslation()
  const [targets, setTargets] = useState<Record<string, WindowTarget[]>>({})
  const available = useMemo(
    () => plugins.filter(plugin => plugin.enabled !== false && plugin.status === 'ready'),
    [plugins],
  )
  useEffect(() => {
    let current = true
    setTargets({})
    if (!active) {
      return
    }
    void Promise.all(
      available
        .filter(plugin =>
          plugin.commands?.some(
            command =>
              command.target === 'window' &&
              (command.menus ?? ['commandCenter']).includes(context.surface),
          ),
        )
        .map(async plugin => {
          try {
            const result = await window.opencoveApi.controlSurface.invoke<{
              windows: WindowTarget[]
            }>({
              kind: 'query',
              id: 'plugin.window.list',
              payload: {
                pluginId: plugin.id,
                ...(context.projectId ? { projectId: context.projectId } : {}),
              },
            })
            return [plugin.id, result.windows] as const
          } catch {
            return [plugin.id, []] as const
          }
        }),
    ).then(entries => {
      if (current) {
        setTargets(Object.fromEntries(entries))
      }
    })
    return () => {
      current = false
    }
  }, [available, context.surface, context.projectId, active])
  const items: HostPluginCommand[] = active
    ? available.flatMap(plugin =>
        (plugin.commands ?? [])
          .filter(command => (command.menus ?? ['commandCenter']).includes(context.surface))
          .flatMap(command => {
            const base = {
              plugin,
              command,
              id: `${plugin.id}:${command.id}`,
              title: `${command.title} · ${plugin.displayName}`,
            }
            if (command.target === 'plugin') {
              return [base]
            }
            return (targets[plugin.id] ?? [])
              .filter(
                target =>
                  (!context.projectId || target.projectId === context.projectId) &&
                  (context.surface !== 'node' || context.nodeIds?.includes(target.nodeId)) &&
                  (context.surface !== 'space' || target.spaceId === context.spaceId),
              )
              .flatMap(target =>
                target.views
                  .filter(view => view.ready)
                  .map(view => ({
                    ...base,
                    id: `${base.id}:${view.viewId}`,
                    title: `${base.title} · ${target.title}${(targets[plugin.id] ?? []).filter(item => item.title === target.title).length > 1 ? ` (${target.nodeId.slice(-6)})` : ''}${target.views.filter(item => item.ready).length > 1 ? ` (${view.viewId.slice(-6)})` : ''}`,
                    target: {
                      nodeId: target.nodeId,
                      viewId: view.viewId,
                      projectId: target.projectId,
                    },
                  })),
              )
          }),
      )
    : []
  const run = async (item: HostPluginCommand) => {
    try {
      const current = getPluginManifest(item.plugin.id)
      if (
        !current ||
        current.enabled === false ||
        current.status !== 'ready' ||
        current.revision !== item.plugin.revision ||
        current.runtimeGeneration !== item.plugin.runtimeGeneration
      ) {
        throw new Error(t('pluginHostExtensions.staleCommand'))
      }
      await window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'plugin.command.run',
        payload: {
          pluginId: item.plugin.id,
          commandId: item.command.id,
          params: null,
          ...item.target,
          context:
            item.target && context.surface === 'commandCenter' && !context.projectId
              ? { ...context, projectId: item.target.projectId }
              : context,
          expectedRevision: item.plugin.revision,
          expectedRuntimeGeneration: item.plugin.runtimeGeneration,
        },
      })
      publishPluginCommandFeedback(
        t('pluginHostExtensions.completed', { title: item.command.title }),
        'info',
      )
    } catch (cause) {
      publishPluginCommandFeedback(pluginErrorMessage(cause), 'error')
    }
  }
  return { items, run }
}
