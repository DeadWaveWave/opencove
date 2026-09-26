import type { PluginNodeData } from '../../types'
import { normalizeOptionalString } from './normalize'

export function ensurePersistedPluginData(value: unknown): PluginNodeData | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const pluginId = normalizeOptionalString(record.pluginId)
  if (!pluginId) {
    return null
  }

  const graphLimit =
    typeof record.graphLimit === 'number' && Number.isFinite(record.graphLimit)
      ? Math.max(10, Math.min(100, Math.floor(record.graphLimit)))
      : 30

  return {
    pluginId: pluginId === 'git-board' ? 'git-board' : 'git-board',
    schemaVersion: 1,
    repoPath: normalizeOptionalString(record.repoPath) ?? '',
    mountId: normalizeOptionalString(record.mountId),
    graphLimit,
  }
}
