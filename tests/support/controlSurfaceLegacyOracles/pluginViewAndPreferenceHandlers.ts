// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/pluginHandlers.ts and pluginPreferenceHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; validator bodies verbatim, imports adjusted.
import { createAppError } from '../../../src/shared/errors/appError'
import { pluginRecord, pluginString } from './localPluginValidation'
function pluginId(payload: unknown) {
  return { pluginId: pluginString(pluginRecord(payload).pluginId, 'id', 80) }
}
function viewInput(payload: unknown): { viewId: string } {
  return { viewId: pluginString(pluginRecord(payload).viewId, 'viewId', 100) }
}
function storageInput(payload: unknown): { viewId: string; key: string; value: unknown } {
  const record = pluginRecord(payload)
  const key = pluginString(record.key, 'storage key', 100)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(key)) {
    throw new Error('Invalid plugin storage key.')
  }
  return { ...viewInput(payload), key, value: record.value }
}
function jsonValue(value: unknown, maxBytes: number): unknown {
  const json = JSON.stringify(value ?? null)
  if (json.length > maxBytes) {
    throw new Error('Plugin payload is too large.')
  }
  return JSON.parse(json) as unknown
}

function wrap<T>(fn: (payload: unknown) => T) {
  return (payload: unknown): T => {
    try {
      return fn(payload)
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
      throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
    }
  }
}
export const normalizePluginViewOpen = wrap((payload: unknown) => {
  const record = pluginRecord(payload)
  if (record.preview !== undefined && typeof record.preview !== 'boolean') {
    throw new Error('Plugin preview must be a boolean.')
  }
  return {
    ...pluginId(payload),
    nodeId: pluginString(record.nodeId, 'nodeId', 200),
    workspaceId:
      record.workspaceId === null || record.workspaceId === undefined
        ? null
        : pluginString(record.workspaceId, 'workspaceId', 200),
    directoryPath:
      record.directoryPath === null || record.directoryPath === undefined
        ? null
        : pluginString(record.directoryPath, 'directoryPath', 4096),
    preview: record.preview === true,
  }
})
export const normalizePluginViewClose = wrap(viewInput)
export const normalizePluginViewSetTitle = wrap((payload: unknown) => ({
  ...viewInput(payload),
  title: pluginString(pluginRecord(payload).title, 'window title', 200),
}))
export const normalizePluginInvoke = wrap((payload: unknown) => {
  const record = pluginRecord(payload)
  return {
    ...viewInput(payload),
    method: pluginString(record.method, 'method', 200),
    params: jsonValue(record.params, 1024 * 1024),
  }
})
export const normalizePluginStorageGet = wrap(storageInput)
export const normalizePluginStorageSet = wrap((payload: unknown) => {
  const input = storageInput(payload)
  return { ...input, value: jsonValue(input.value, 1024 * 1024) }
})
export function preferenceInput(view: boolean, write: boolean) {
  return (raw: unknown) => {
    const input = pluginRecord(raw)
    const key = view ? 'viewId' : 'pluginId'
    if (
      Object.keys(input).some(field => ![key, ...(write ? ['key', 'value'] : [])].includes(field))
    ) {
      throw new Error('Unexpected preference argument.')
    }
    return {
      id: pluginString(input[key], key, 200),
      key: write ? pluginString(input.key, 'preference key', 80) : '',
      value: input.value,
    }
  }
}
export const normalizePluginPreferencesGet = preferenceInput(false, false)
export const normalizePluginPreferencesSet = preferenceInput(false, true)
export const normalizePluginViewPreferencesGet = preferenceInput(true, false)
export const normalizePluginViewPreferencesSet = preferenceInput(true, true)
