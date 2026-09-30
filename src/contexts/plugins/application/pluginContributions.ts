import type { PluginPreferenceValue } from '../domain/pluginTypes'
import type {
  PluginCommandTarget,
  PluginLiveView,
  PluginSkillDetails,
} from '../domain/pluginRuntimeTypes'
import type { PluginFilesPort } from './PluginRuntimePorts'
import type { PluginRuntimeState, PluginRuntimeView } from './PluginRuntimeState'
import type { PluginWindowCommands } from './PluginWindowCommands'

export function listPluginViews(
  views: PluginRuntimeView[],
  commands: PluginWindowCommands,
): PluginLiveView[] {
  return views
    .filter(view => !view.context.preview)
    .map(view => ({
      nodeId: view.context.nodeId,
      viewId: view.id,
      ready: commands.isReady(view.id),
      ...(view.contentTitle === undefined ? {} : { contentTitle: view.contentTitle }),
    }))
}

export async function runPluginCommand(
  runtime: PluginRuntimeState,
  views: PluginRuntimeView[],
  windows: PluginWindowCommands,
  commandId: string,
  params: unknown,
  target: PluginCommandTarget,
  preferences?: Record<string, PluginPreferenceValue>,
): Promise<unknown> {
  if (!runtime.record.enabled || runtime.error) {
    throw new Error(runtime.error ?? 'Plugin is disabled.')
  }
  const command = runtime.record.package.contributes?.commands?.find(item => item.id === commandId)
  if (!command) {
    throw new Error(`Plugin command is not declared: ${commandId}`)
  }
  if (command.target === 'plugin') {
    if (target.nodeId || target.viewId) {
      throw new Error('Plugin command does not accept a window target.')
    }
    if (!runtime.backend?.runCommand) {
      throw new Error('Plugin does not provide a command backend.')
    }
    return await runtime.backend.runCommand(commandId, params, {
      pluginId: runtime.record.package.id,
      ...(target.context ? { host: target.context } : {}),
      ...(preferences ? { preferences } : {}),
    })
  }
  if (!target.nodeId) {
    throw new Error('Window command requires an explicit nodeId.')
  }
  const candidates = listPluginViews(views, windows).filter(
    view =>
      view.nodeId === target.nodeId &&
      view.ready &&
      (!target.viewId || view.viewId === target.viewId),
  )
  if (!candidates.length) {
    throw new Error('Plugin window is not ready; open it and register its command handler.')
  }
  if (candidates.length > 1) {
    throw new Error('Plugin window is open on multiple clients; specify a viewId.')
  }
  return await windows.run(candidates[0].viewId, commandId, params, target.context)
}

export async function readPluginSkill(
  files: PluginFilesPort,
  runtime: PluginRuntimeState,
  skillId: string,
): Promise<PluginSkillDetails> {
  const skill = runtime.record.package.contributes?.skills?.find(item => item.id === skillId)
  if (!skill) {
    throw new Error(`Plugin skill is not declared: ${skillId}`)
  }
  if (!runtime.snapshot) {
    throw new Error('Plugin artifact is unavailable.')
  }
  const content = await files.readSkill(runtime.snapshot, skill.path)
  return {
    pluginId: runtime.record.package.id,
    skill: { ...skill },
    ...content,
    installPrompt: `Install the "${skill.id}" Agent Skill from ${content.path} on the connected OpenCove Worker. Read SKILL.md first, then copy its containing directory and bundled resources to the agent skills directory chosen by the user. This command has not installed or modified any agent skill.`,
  }
}
