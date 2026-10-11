import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { resolveSpaceMountContext } from '../../../../contexts/space/application/resolveSpaceMountContext'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import type {
  PluginResolvedTarget,
  PluginTargetInput,
} from '../../../../contexts/plugins/domain/pluginHostTypes'
import {
  pluginRecord,
  pluginString,
} from '../../../../contexts/plugins/domain/localPluginValidation'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { pluginJsonValue } from '../../../../contexts/plugins/domain/pluginJsonValue'

/** Selection metadata only. Listing never picks a project or resolves an execution target. */
export async function listPluginTargets(deps: {
  getPersistenceStore(): Promise<PersistenceStore>
}) {
  const state = normalizePersistedAppState(await (await deps.getPersistenceStore()).readAppState())
  const catalog = {
    projects: (state?.workspaces ?? []).map(project => ({
      id: project.id,
      name: project.name,
      spaces: project.spaces.map(space => ({ id: space.id, name: space.name })),
    })),
  }
  pluginJsonValue(catalog, 1024 * 1024, 'target catalog')
  return catalog
}

export function pluginTargetInput(value: unknown): PluginTargetInput {
  const record = pluginRecord(value)
  if (Object.keys(record).some(key => !['projectId', 'spaceId'].includes(key))) {
    throw new Error('Target accepts projectId and optional spaceId only.')
  }
  return {
    projectId: pluginString(record.projectId, 'target projectId', 200),
    ...(record.spaceId === undefined
      ? {}
      : { spaceId: pluginString(record.spaceId, 'target spaceId', 200) }),
  }
}

export async function resolvePluginTarget(
  input: PluginTargetInput,
  deps: {
    getPersistenceStore(): Promise<PersistenceStore>
    topology: Pick<WorkerTopologyStore, 'listMounts' | 'resolveMountTarget'>
  },
): Promise<PluginResolvedTarget> {
  const state = normalizePersistedAppState(await (await deps.getPersistenceStore()).readAppState())
  const project = state?.workspaces.find(item => item.id === input.projectId)
  if (!project) {
    throw new Error('Plugin target project is unavailable; select an existing project explicitly.')
  }
  const space = input.spaceId ? project.spaces.find(item => item.id === input.spaceId) : null
  if (input.spaceId && !space) {
    throw new Error('Plugin target Space does not belong to this project.')
  }
  const { mounts } = await deps.topology.listMounts({ projectId: input.projectId })
  // An explicit binding that disappeared must never select a different machine by matching a path.
  if (space?.targetMountId && !mounts.some(item => item.mountId === space.targetMountId)) {
    throw new Error('Plugin target mount is unavailable; reconnect or repair the Space location.')
  }
  const context = resolveSpaceMountContext({
    space: space ?? null,
    workspacePath: project.path,
    mounts,
    fallbackToFirstMount: !space,
  })
  if (!context.mount) {
    throw new Error('Plugin target has no valid mount; configure its project or Space location.')
  }
  const target = await deps.topology.resolveMountTarget({ mountId: context.mount.mountId })
  if (
    !target ||
    target.projectId !== input.projectId ||
    target.endpointId !== context.mount.endpointId ||
    target.rootUri !== context.mount.rootUri
  ) {
    throw new Error('Plugin target changed during resolution; resolve it again.')
  }
  return {
    projectId: input.projectId,
    spaceId: space?.id ?? null,
    mountId: target.mountId,
    endpointId: target.endpointId,
    rootUri: context.scope?.rootUri ?? target.rootUri,
    cwdUri: toFileUri(context.workingDirectory),
    workingDirectory: context.workingDirectory,
  }
}

export function pluginRelativeUri(target: PluginResolvedTarget, value: unknown): string {
  if (
    value !== undefined &&
    (typeof value !== 'string' || value.length === 0 || value.length > 4096)
  ) {
    throw new Error('Invalid plugin relative path.')
  }
  const path = value === undefined ? '.' : (value as string)
  if (/^[\\/]|^[a-zA-Z]:/.test(path) || path.includes('\0')) {
    throw new Error('Plugin file path must be relative to the target working directory.')
  }
  const parts = path.replace(/\\/g, '/').split('/')
  if (parts.includes('..')) {
    throw new Error('Plugin file path cannot leave the target directory.')
  }
  const base = target.cwdUri.endsWith('/') ? target.cwdUri : `${target.cwdUri}/`
  return new URL(
    parts
      .filter(part => part !== '.' && part !== '')
      .map(encodeURIComponent)
      .join('/'),
    base,
  ).href
}
