import type { PluginNodeData } from '../../types'
import { normalizeOptionalString } from './normalize'

export function ensurePersistedPluginData(value: unknown): PluginNodeData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const pluginId = normalizeOptionalString(record.pluginId)
  if (!pluginId) {
    return null
  }

  const schemaVersion =
    typeof record.schemaVersion === 'number' &&
    Number.isInteger(record.schemaVersion) &&
    record.schemaVersion > 0
      ? record.schemaVersion
      : 1

  return {
    ...record,
    // Preserve identity and version even when this build cannot run the plugin.
    pluginId,
    schemaVersion,
    repoPath: typeof record.repoPath === 'string' ? record.repoPath : '',
    mountId: typeof record.mountId === 'string' ? record.mountId : null,
  }
}
