import { pluginRecord, pluginString } from './pluginPrimitives'
import { pluginJsonValue } from './pluginJsonValue'
import { createAppError } from '../../../errors/appError'
import { distributionFields } from './pluginDistributionInput'
export const normalizePluginSidebar = (value: unknown) => {
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
}
export const normalizePluginHost = (value: unknown) => {
  const input = pluginHostFields(value, ['viewId', 'operation', 'payload'])
  return {
    viewId: pluginString(input.viewId, 'viewId', 100),
    operation: pluginString(input.operation, 'host operation', 100),
    payload: pluginJsonValue(input.payload, 2 * 1024 * 1024, 'host request'),
  }
}
export function pluginHostFields(payload: unknown, allowed: string[]) {
  const record = pluginRecord(payload)
  if (Object.keys(record).some(key => !allowed.includes(key))) {
    throw new Error('Unsupported plugin host argument.')
  }
  return record
}

export function normalizePluginRepository(value: unknown) {
  try {
    return pluginString(distributionFields(value, ['repository']).repository, 'repository', 2000)
  } catch (error) {
    const reason = String(error instanceof Error ? error.message : error).slice(0, 2000)
    throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
  }
}
