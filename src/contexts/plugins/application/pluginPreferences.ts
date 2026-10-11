import type { PluginFilesPort } from './PluginRuntimePorts'
import type { PluginRuntimeState } from './PluginRuntimeState'
import type { PluginPreferenceDeclaration, PluginPreferenceValue } from '../domain/pluginTypes'
import { isPluginPreferenceValue } from '../domain/pluginHostExtensionValidation'

/** Reserved to the host owner; generic plugin storage must reject this key. */
export const PLUGIN_PREFERENCES_KEY = 'opencove.host.preferences'
export type PluginPreferences = Record<string, PluginPreferenceValue>

export function resolvePluginPreferences(
  schema: readonly PluginPreferenceDeclaration[],
  saved: unknown,
): PluginPreferences {
  const values =
    saved && typeof saved === 'object' && !Array.isArray(saved)
      ? (saved as Record<string, unknown>)
      : {}
  return Object.fromEntries(
    schema.map(item => [
      item.id,
      isPluginPreferenceValue(item, values[item.id]) ? values[item.id] : item.default,
    ]),
  ) as PluginPreferences
}
export async function readPluginPreferences(
  files: Pick<PluginFilesPort, 'readStorage' | 'writeStorage'>,
  runtime: PluginRuntimeState,
): Promise<PluginPreferences> {
  return resolvePluginPreferences(
    runtime.record.package.contributes?.preferences ?? [],
    await files.readStorage(runtime.record.package.id, PLUGIN_PREFERENCES_KEY),
  )
}
/** Caller serializes writes with installation lifecycle. Unknown stored keys survive schema revisions. */
export async function writePluginPreference(
  files: Pick<PluginFilesPort, 'readStorage' | 'writeStorage'>,
  runtime: PluginRuntimeState,
  key: string,
  value: unknown,
  assertActive?: () => void,
): Promise<PluginPreferences> {
  const schema = runtime.record.package.contributes?.preferences ?? []
  const field = schema.find(item => item.id === key)
  if (!field || !isPluginPreferenceValue(field, value)) {
    throw new Error('Invalid plugin preference value.')
  }
  const saved = await files.readStorage(runtime.record.package.id, PLUGIN_PREFERENCES_KEY)
  const previous =
    saved && typeof saved === 'object' && !Array.isArray(saved)
      ? (saved as Record<string, unknown>)
      : {}
  const next = { ...previous, [key]: value }
  assertActive?.()
  await files.writeStorage(runtime.record.package.id, PLUGIN_PREFERENCES_KEY, next)
  return resolvePluginPreferences(schema, next)
}
