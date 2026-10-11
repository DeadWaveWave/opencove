import type { PluginHostContext } from './pluginRuntimeTypes'
import { pluginRecord, pluginString } from './localPluginValidation'

export function normalizePluginHostContext(value: unknown): PluginHostContext | undefined {
  if (value === undefined) {
    return undefined
  }
  const raw = pluginRecord(value)
  if (
    Object.keys(raw).some(key => !['surface', 'projectId', 'spaceId', 'nodeIds'].includes(key)) ||
    !['commandCenter', 'canvas', 'node', 'space', 'sidebar'].includes(String(raw.surface))
  ) {
    throw new Error('Invalid plugin command context.')
  }
  const result: PluginHostContext = { surface: raw.surface as PluginHostContext['surface'] }
  for (const key of ['projectId', 'spaceId'] as const) {
    if (raw[key] !== undefined) {
      result[key] = pluginString(raw[key], key, 200)
    }
  }
  if (raw.nodeIds !== undefined) {
    if (
      !Array.isArray(raw.nodeIds) ||
      raw.nodeIds.length > 100 ||
      new Set(raw.nodeIds).size !== raw.nodeIds.length
    ) {
      throw new Error('Invalid plugin command node selection.')
    }
    result.nodeIds = raw.nodeIds.map(id => pluginString(id, 'nodeId', 200))
  }
  if (result.nodeIds && result.surface !== 'node') {
    throw new Error('Node selections require a node menu context.')
  }
  if (result.spaceId && !['space', 'commandCenter'].includes(result.surface)) {
    throw new Error('Space selection is not valid for this menu context.')
  }
  if (result.spaceId && !result.projectId) {
    throw new Error('Space context requires an explicit project.')
  }
  if (result.surface !== 'commandCenter' && !result.projectId) {
    throw new Error('Plugin context requires an explicit project.')
  }
  if (result.surface === 'space' && !result.spaceId) {
    throw new Error('Plugin Space context requires a Space.')
  }
  if (result.surface === 'node' && !result.nodeIds?.length) {
    throw new Error('Plugin node context requires a selection.')
  }
  return result
}
