import { createAppError } from '../../../errors/appError'
import { pluginRecord, pluginString } from './pluginPrimitives'
import { normalizePluginHostContext } from './pluginCommandContext'
import { pluginJsonValue } from './pluginJsonValue'
import { distributionFields, gitInstallInput, pluginGitRef } from './pluginDistributionInput'

function pluginNormalize<T>(normalize: (value: unknown) => T) {
  return (value: unknown): T => {
    try {
      return normalize(value)
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
      throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
    }
  }
}
export function pluginId(payload: unknown): { pluginId: string } {
  return { pluginId: pluginString(pluginRecord(payload).pluginId, 'id', 80) }
}
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
function windowInput(value: unknown, operation: 'open' | 'list' | 'run') {
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
  let anchor: { x: number; y: number } | undefined
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

const id = (value: unknown) => {
  const record = distributionFields(value, ['pluginId'])
  return pluginString(record.pluginId, 'id', 80)
}
const update = (value: unknown) => {
  const record = distributionFields(value, ['pluginId', 'ref'])
  return {
    pluginId: pluginString(record.pluginId, 'id', 80),
    ref: record.ref === undefined ? undefined : pluginGitRef(record.ref),
  }
}
export const pluginListInput = pluginNormalize(() => null)
export const pluginDetailsInput = pluginNormalize(pluginId)
export const pluginInstallInput = pluginNormalize((payload: unknown) => ({
  directory: pluginString(pluginRecord(payload).directory, 'directory', 4096),
}))
export const pluginReloadInput = pluginNormalize(pluginId)
export const pluginUninstallInput = pluginNormalize(pluginId)
export const pluginSetEnabledInput = pluginNormalize((payload: unknown) => {
  const record = pluginRecord(payload)
  if (typeof record.enabled !== 'boolean') {
    throw new Error('Plugin enabled must be a boolean.')
  }
  return { ...pluginId(payload), enabled: record.enabled }
})
export const pluginWindowOpenInput = pluginNormalize((value: unknown) => windowInput(value, 'open'))
export const pluginWindowListInput = pluginNormalize((value: unknown) => windowInput(value, 'list'))
export const pluginSkillGetInput = pluginNormalize((value: unknown) => {
  const record = fields(value, ['pluginId', 'skillId'])
  return {
    pluginId: pluginString(record.pluginId, 'id', 80),
    skillId: pluginString(record.skillId, 'skillId', 80),
  }
})
export const pluginCommandRunInput = pluginNormalize((value: unknown) => {
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
})
export const pluginGitInstallInput = pluginNormalize(gitInstallInput)
export const pluginSourceInput = pluginNormalize(id)
export const pluginGitCheckInput = pluginNormalize(update)
export const pluginGitUpdateInput = pluginNormalize(update)
export const pluginGitApplyInput = pluginNormalize((value: unknown) =>
  pluginString(distributionFields(value, ['candidateId']).candidateId, 'candidate id', 80),
)
export const pluginRollbackInput = pluginNormalize((value: unknown) => {
  const record = distributionFields(value, ['pluginId', 'revision'])
  return {
    pluginId: pluginString(record.pluginId, 'id', 80),
    revision: pluginString(record.revision, 'revision', 64),
  }
})
export const pluginDiscoverInput = pluginNormalize((value: unknown) => {
  const record = distributionFields(value ?? {}, ['query'])
  return record.query === undefined || record.query === ''
    ? ''
    : pluginString(record.query, 'search', 200)
})
