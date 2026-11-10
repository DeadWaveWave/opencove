import type {
  AddProjectResult,
  CreateSpaceResult,
} from '../../../shared/contracts/dto/workspaceBootstrap'
import type { WorkspaceBootstrapMutationOwner } from './workspaceBootstrapMutationOwner'
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettings } from '../../settings/domain/agentSettings'
import { createAppError } from '../../../shared/errors/appError'
import {
  createProjectRecord,
  createTopLevelSpaceRecord,
  emptySpaceSize,
} from '../domain/workspaceBootstrap'
import { resolveWorkspaceNodesPlacement } from '../domain/workspaceNodePlacement'
import {
  persistNodeControlState,
  type NodeControlAppStateStore,
  type NodeControlWorkspace,
} from './nodeControl/nodeControlState'
import type { MountDto } from '../../../shared/contracts/dto'

export interface WorkspaceBootstrapPorts {
  mutationOwner: WorkspaceBootstrapMutationOwner
  validateSpaceDirectory: (mount: MountDto, directoryPath?: string) => Promise<string>
  store: NodeControlAppStateStore
  createId: () => string
  validateDirectory: (path: string) => Promise<string>
  approveRoot: (path: string) => Promise<unknown>
  listMounts: (projectId: string) => Promise<MountDto[]>
  createMount: (projectId: string, path: string) => Promise<MountDto>
  assertActive?: () => void
}

function newSpace(
  workspace: NodeControlWorkspace,
  mount: MountDto,
  input: { name: string; directoryPath?: string },
  settings: unknown,
  createId: () => string,
) {
  const size = emptySpaceSize(normalizeAgentSettings(settings).standardWindowSizeBucket)
  const result = resolveWorkspaceNodesPlacement({
    anchor: { x: Math.round(-size.width / 2), y: Math.round(-size.height / 2) },
    size,
    nodes: workspace.nodes.map(node => ({
      ...node,
      data: { width: node.width, height: node.height },
    })),
    spaceRects: workspace.spaces.flatMap(space => (space.rect ? [space.rect] : [])),
  })
  if (!result.canPlace) {
    throw createAppError('common.invalid_input', { debugMessage: 'No free space placement.' })
  }
  return createTopLevelSpaceRecord({
    id: createId(),
    name: input.name,
    directoryPath: input.directoryPath ?? mount.rootPath,
    targetMountId: mount.mountId,
    rect: { ...result.placement, ...size },
  })
}

async function addProjectMutation(
  ports: WorkspaceBootstrapPorts,
  input: { path: string; name?: string },
): Promise<AddProjectResult> {
  const path = await ports.validateDirectory(input.path)
  const revision = await ports.store.readAppStateRevision()
  const state = (await ports.store.readAppState()) ?? {
    formatVersion: 1,
    activeWorkspaceId: null,
    workspaces: [],
    settings: DEFAULT_AGENT_SETTINGS,
  }
  const existing = state.workspaces.find(workspace => workspace.path === path)
  const workspace =
    existing ??
    createProjectRecord({
      id: ports.createId(),
      name: input.name ?? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
      path,
    })
  const mounts = existing ? await ports.listMounts(existing.id) : []
  let mount = mounts[0]

  ports.assertActive?.()
  await ports.approveRoot(path)
  ports.assertActive?.()
  if (!mount) {
    // A published mount may already be adopted by a renderer or another writer.
    // Never delete it as compensation for a later app-state conflict.
    mount = await ports.createMount(workspace.id, path)
  }
  const space =
    workspace.spaces.find(candidate => candidate.targetMountId === mount.mountId) ??
    newSpace(
      workspace,
      mount,
      { name: 'Space 1', directoryPath: await ports.validateSpaceDirectory(mount) },
      state.settings,
      ports.createId,
    )
  const nextWorkspace = {
    ...workspace,
    spaces: workspace.spaces.some(item => item.id === space.id)
      ? workspace.spaces
      : [...workspace.spaces, space],
  }
  ports.assertActive?.()
  await persistNodeControlState(
    ports.store,
    {
      ...state,
      activeWorkspaceId: workspace.id,
      workspaces: existing
        ? state.workspaces.map(item => (item.id === workspace.id ? nextWorkspace : item))
        : [...state.workspaces, nextWorkspace],
    },
    revision,
  )
  return {
    projectId: workspace.id,
    spaceId: space.id,
    mountId: mount.mountId,
    project: { id: workspace.id, name: workspace.name, path: workspace.path },
    space,
  }
}

async function createSpaceMutation(
  ports: WorkspaceBootstrapPorts,
  input: { projectId: string; name: string; directoryPath?: string },
): Promise<CreateSpaceResult> {
  const revision = await ports.store.readAppStateRevision()
  const state = await ports.store.readAppState()
  const workspace = state?.workspaces.find(item => item.id === input.projectId)
  if (!state || !workspace) {
    throw createAppError('common.invalid_input', { debugMessage: 'Unknown projectId.' })
  }
  const mount = (await ports.listMounts(workspace.id))[0]
  if (!mount) {
    throw createAppError('common.invalid_input', { debugMessage: 'Project has no default mount.' })
  }
  const directoryPath = await ports.validateSpaceDirectory(mount, input.directoryPath)
  const space = newSpace(
    workspace,
    mount,
    { ...input, directoryPath },
    state.settings,
    ports.createId,
  )
  ports.assertActive?.()
  await persistNodeControlState(
    ports.store,
    {
      ...state,
      workspaces: state.workspaces.map(item =>
        item.id === workspace.id ? { ...item, spaces: [...item.spaces, space] } : item,
      ),
    },
    revision,
  )
  return { projectId: workspace.id, spaceId: space.id, mountId: mount.mountId, space }
}

export function addProject(ports: WorkspaceBootstrapPorts, input: { path: string; name?: string }) {
  return ports.mutationOwner.run(() => addProjectMutation(ports, input))
}

export function createSpace(
  ports: WorkspaceBootstrapPorts,
  input: { projectId: string; name: string; directoryPath?: string },
): Promise<CreateSpaceResult> {
  return ports.mutationOwner.run(() => createSpaceMutation(ports, input))
}
