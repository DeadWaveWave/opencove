import type {
  GitWorktreeInfo,
  MountDto,
  SpaceLocator,
  SpaceResolutionCandidate,
  WorkerEndpointDto,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  NodeControlAppState,
  NodeControlSpace,
  NodeControlWorkspace,
} from './nodeControlState'
import { resolveSpaceWorkingDirectory } from '../../../space/application/resolveSpaceWorkingDirectory'

type Workspace = NodeControlWorkspace
type Space = NodeControlSpace

export interface ResolvedSpaceForNodeControl {
  workspace: Workspace
  space: Space
  workingDirectory: string
  endpoint: WorkerEndpointDto
  mount: MountDto | null
}

export interface SpaceLocatorResolverDeps {
  listEndpoints: () => Promise<WorkerEndpointDto[]>
  listMounts: (projectId: string) => Promise<MountDto[]>
  listWorktreesForMount: (mountId: string) => Promise<GitWorktreeInfo[]>
  listWorktreesForWorkspace: (workspace: Workspace) => Promise<GitWorktreeInfo[]>
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isAbsolutePathLike(pathValue: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(pathValue)
}

function normalizeComparablePath(pathValue: string): string {
  const normalized = pathValue.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const root = normalizeComparablePath(rootPath)
  const target = normalizeComparablePath(targetPath)
  return target === root || target.startsWith(`${root}/`)
}

function pathsEqual(left: string, right: string): boolean {
  return normalizeComparablePath(left) === normalizeComparablePath(right)
}

function branchEquals(left: string | null | undefined, right: string): boolean {
  return (left ?? '').trim() === right.trim()
}

function candidateFromResolved(
  resolved: ResolvedSpaceForNodeControl,
  matchReason: string,
  branch?: string | null,
): SpaceResolutionCandidate {
  return {
    spaceId: resolved.space.id,
    spaceName: resolved.space.name,
    projectId: resolved.workspace.id,
    worker: {
      endpointId: resolved.endpoint.endpointId,
      displayName: resolved.endpoint.displayName,
    },
    directoryPath: resolved.workingDirectory,
    matchReason,
    ...(branch !== undefined ? { branch } : {}),
  }
}

function throwAmbiguous(candidates: SpaceResolutionCandidate[]): never {
  throw createAppError('space.ambiguous', {
    details: { candidates },
    debugMessage: `Space locator matched ${candidates.length} spaces.`,
  })
}

function throwNotFound(): never {
  throw createAppError('space.not_found', {
    debugMessage: 'Space locator did not match any space.',
  })
}

function workspacesForProject(state: NodeControlAppState, projectId?: string | null): Workspace[] {
  const normalizedProjectId = normalizeOptionalString(projectId)
  return normalizedProjectId
    ? state.workspaces.filter(workspace => workspace.id === normalizedProjectId)
    : state.workspaces
}

async function createMountCache(
  workspaces: Workspace[],
  deps: SpaceLocatorResolverDeps,
): Promise<Map<string, MountDto[]>> {
  const uniqueWorkspaces = [
    ...new Map(workspaces.map(workspace => [workspace.id, workspace])).values(),
  ]
  const entries = await Promise.all(
    uniqueWorkspaces.map(
      async workspace => [workspace.id, await deps.listMounts(workspace.id)] as const,
    ),
  )
  return new Map(entries)
}

function resolveWorkerEndpoint(worker: string, endpoints: WorkerEndpointDto[]): WorkerEndpointDto {
  const normalized = worker.trim()
  const byId = endpoints.find(endpoint => endpoint.endpointId === normalized) ?? null
  if (byId) {
    return byId
  }

  const byDisplayName = endpoints.filter(endpoint => endpoint.displayName === normalized)
  if (byDisplayName.length === 1) {
    return byDisplayName[0]
  }

  if (byDisplayName.length > 1) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Worker display name is ambiguous: ${normalized}`,
    })
  }

  throw createAppError('worker.unavailable', {
    debugMessage: `Unknown worker: ${normalized}`,
  })
}

function resolveMountForSpace(
  workspace: Workspace,
  space: Space,
  mountsByProject: Map<string, MountDto[]>,
  localEndpoint: WorkerEndpointDto,
): { mount: MountDto | null; endpointId: string; workingDirectory: string } {
  const workingDirectory = resolveSpaceWorkingDirectory(space, workspace.path)
  const mount =
    space.targetMountId && space.targetMountId.trim().length > 0
      ? (mountsByProject.get(workspace.id)?.find(item => item.mountId === space.targetMountId) ??
        null)
      : null

  return {
    mount,
    endpointId: mount?.endpointId ?? localEndpoint.endpointId,
    workingDirectory,
  }
}

async function enumerateResolvedSpaces(
  state: NodeControlAppState,
  deps: SpaceLocatorResolverDeps,
  projectId?: string | null,
): Promise<ResolvedSpaceForNodeControl[]> {
  const endpoints = await deps.listEndpoints()
  const localEndpoint = endpoints.find(endpoint => endpoint.endpointId === 'local') ?? {
    endpointId: 'local',
    kind: 'local' as const,
    displayName: 'Local',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    access: null,
    remote: null,
  }
  const endpointById = new Map(endpoints.map(endpoint => [endpoint.endpointId, endpoint]))
  const workspaces = workspacesForProject(state, projectId)
  const mountsByProject = await createMountCache(workspaces, deps)
  const result: ResolvedSpaceForNodeControl[] = []

  for (const workspace of workspaces) {
    for (const space of workspace.spaces) {
      const resolved = resolveMountForSpace(workspace, space, mountsByProject, localEndpoint)
      const endpoint = endpointById.get(resolved.endpointId) ?? localEndpoint
      result.push({
        workspace,
        space,
        workingDirectory: resolved.workingDirectory,
        endpoint,
        mount: resolved.mount,
      })
    }
  }

  return result
}

async function resolveBySpaceId(
  state: NodeControlAppState,
  deps: SpaceLocatorResolverDeps,
  spaceId: string,
): Promise<ResolvedSpaceForNodeControl> {
  const all = await enumerateResolvedSpaces(state, deps)
  const matched = all.find(item => item.space.id === spaceId.trim()) ?? null
  if (!matched) {
    throwNotFound()
  }

  return matched
}

async function resolveBySpaceName(
  state: NodeControlAppState,
  deps: SpaceLocatorResolverDeps,
  locator: Extract<SpaceLocator, { kind: 'spaceName' }>,
): Promise<ResolvedSpaceForNodeControl> {
  const name = locator.name.trim()
  const matches = (await enumerateResolvedSpaces(state, deps, locator.projectId)).filter(
    item => item.space.name === name,
  )

  if (matches.length === 1) {
    return matches[0]
  }

  if (matches.length > 1) {
    throwAmbiguous(matches.map(item => candidateFromResolved(item, 'space-name')))
  }

  throwNotFound()
}

async function resolveByWorkerPath(
  state: NodeControlAppState,
  deps: SpaceLocatorResolverDeps,
  locator: Extract<SpaceLocator, { kind: 'workerPath' }>,
): Promise<ResolvedSpaceForNodeControl> {
  const inputPath = locator.path.trim()
  if (!isAbsolutePathLike(inputPath)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'workerPath locator requires an absolute path.',
    })
  }

  const endpoint = resolveWorkerEndpoint(locator.worker, await deps.listEndpoints())
  const matches = (await enumerateResolvedSpaces(state, deps, locator.projectId)).filter(
    item =>
      item.endpoint.endpointId === endpoint.endpointId &&
      isPathInside(item.workingDirectory, inputPath),
  )

  if (matches.length === 0) {
    throwNotFound()
  }

  const scored = matches
    .map(item => ({ item, score: normalizeComparablePath(item.workingDirectory).length }))
    .sort((a, b) => b.score - a.score)
  const bestScore = scored[0].score
  const best = scored.filter(item => item.score === bestScore).map(item => item.item)

  if (best.length === 1) {
    return best[0]
  }

  throwAmbiguous(best.map(item => candidateFromResolved(item, 'worker-path-longest-containing')))
}

async function resolveByWorkerBranch(
  state: NodeControlAppState,
  deps: SpaceLocatorResolverDeps,
  locator: Extract<SpaceLocator, { kind: 'workerBranch' }>,
): Promise<ResolvedSpaceForNodeControl> {
  const endpoint = resolveWorkerEndpoint(locator.worker, await deps.listEndpoints())
  const branch = locator.branch.trim()
  const spaces = (await enumerateResolvedSpaces(state, deps, locator.projectId)).filter(
    item => item.endpoint.endpointId === endpoint.endpointId,
  )
  const matches: Array<{ resolved: ResolvedSpaceForNodeControl; branch: string | null }> = []
  const uniqueMounts = [
    ...new Map(
      spaces.flatMap(resolved =>
        resolved.mount ? [[resolved.mount.mountId, resolved.mount] as const] : [],
      ),
    ).values(),
  ]
  const uniqueLocalWorkspaces = [
    ...new Map(
      spaces.flatMap(resolved =>
        resolved.mount ? [] : [[resolved.workspace.id, resolved.workspace] as const],
      ),
    ).values(),
  ]
  const worktreesByMount = new Map(
    await Promise.all(
      uniqueMounts.map(
        async mount => [mount.mountId, await deps.listWorktreesForMount(mount.mountId)] as const,
      ),
    ),
  )
  const worktreesByWorkspace = new Map(
    await Promise.all(
      uniqueLocalWorkspaces.map(
        async workspace => [workspace.id, await deps.listWorktreesForWorkspace(workspace)] as const,
      ),
    ),
  )

  for (const resolved of spaces) {
    const worktrees = resolved.mount
      ? (worktreesByMount.get(resolved.mount.mountId) ?? [])
      : (worktreesByWorkspace.get(resolved.workspace.id) ?? [])

    const matchedWorktree =
      worktrees.find(worktree => pathsEqual(worktree.path, resolved.workingDirectory)) ?? null
    if (!matchedWorktree || !branchEquals(matchedWorktree.branch, branch)) {
      continue
    }

    matches.push({ resolved, branch: matchedWorktree.branch ?? null })
  }

  if (matches.length === 1) {
    return matches[0].resolved
  }

  if (matches.length > 1) {
    throwAmbiguous(
      matches.map(item => candidateFromResolved(item.resolved, 'worker-branch', item.branch)),
    )
  }

  throwNotFound()
}

export async function resolveSpaceLocatorForNodeControl(
  state: NodeControlAppState,
  deps: SpaceLocatorResolverDeps,
  locator: SpaceLocator,
): Promise<ResolvedSpaceForNodeControl> {
  if (locator.kind === 'spaceId') {
    return await resolveBySpaceId(state, deps, locator.spaceId)
  }

  if (locator.kind === 'spaceName') {
    return await resolveBySpaceName(state, deps, locator)
  }

  if (locator.kind === 'workerPath') {
    return await resolveByWorkerPath(state, deps, locator)
  }

  return await resolveByWorkerBranch(state, deps, locator)
}

export async function listSpacesForNodeControl(
  state: NodeControlAppState,
  deps: SpaceLocatorResolverDeps,
  projectId?: string | null,
): Promise<ResolvedSpaceForNodeControl[]> {
  return await enumerateResolvedSpaces(state, deps, projectId)
}