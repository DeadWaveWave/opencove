import type {
  AppUpdateState,
  CliPathStatusResult,
  HomeWorkerConfigDto,
  ListWorkspacePathOpenersResult,
  ReleaseNotesCurrentResult,
  WorkerStatusResult,
} from '@shared/contracts/dto'
import type {
  PersistedAppState,
  PersistedTerminalNode,
  PersistedWorkspaceState,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'

export function resolveBrowserPlatform(): string {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  const normalized = platform.toLowerCase()
  if (normalized.includes('mac')) {
    return 'darwin'
  }
  if (normalized.includes('win')) {
    return 'win32'
  }
  if (normalized.includes('linux')) {
    return 'linux'
  }
  return 'browser'
}

function normalizeWorkspacePathForMatch(path: string, platform: string): string {
  const trimmed = path.trim()
  if (trimmed.length === 0) {
    return ''
  }

  const normalizedSeparators = trimmed.replaceAll('\\', '/')
  const strippedTrailing = normalizedSeparators.replace(/\/+$/g, '')

  return platform === 'win32' ? strippedTrailing.toLowerCase() : strippedTrailing
}

function isPathWithinRoot(root: string, target: string, platform: string): boolean {
  const normalizedRoot = normalizeWorkspacePathForMatch(root, platform)
  const normalizedTarget = normalizeWorkspacePathForMatch(target, platform)

  if (normalizedRoot.length === 0 || normalizedTarget.length === 0) {
    return false
  }

  if (normalizedRoot === normalizedTarget) {
    return true
  }

  return normalizedTarget.startsWith(`${normalizedRoot}/`)
}

export function resolveSpaceIdForCwd(options: {
  appState: unknown
  cwd: string
  platform: string
}): string | null {
  const { appState, cwd, platform } = options

  if (!appState || typeof appState !== 'object' || Array.isArray(appState)) {
    return null
  }

  const workspacesRaw = (appState as Record<string, unknown>).workspaces
  if (!Array.isArray(workspacesRaw)) {
    return null
  }

  const normalizedCwd = normalizeWorkspacePathForMatch(cwd, platform)

  type SpaceCandidate = {
    id: string
    directoryPath: string
    workspacePath: string
  }

  const candidates: SpaceCandidate[] = []

  for (const workspaceRaw of workspacesRaw) {
    if (!workspaceRaw || typeof workspaceRaw !== 'object' || Array.isArray(workspaceRaw)) {
      continue
    }

    const workspaceRecord = workspaceRaw as Record<string, unknown>
    const workspacePathRaw = typeof workspaceRecord.path === 'string' ? workspaceRecord.path : ''
    const workspacePath = normalizeWorkspacePathForMatch(workspacePathRaw, platform)

    const spacesRaw = workspaceRecord.spaces
    if (!Array.isArray(spacesRaw)) {
      continue
    }

    for (const spaceRaw of spacesRaw) {
      if (!spaceRaw || typeof spaceRaw !== 'object' || Array.isArray(spaceRaw)) {
        continue
      }

      const spaceRecord = spaceRaw as Record<string, unknown>
      const id = typeof spaceRecord.id === 'string' ? spaceRecord.id.trim() : ''
      if (id.length === 0) {
        continue
      }

      const directoryPathRaw =
        typeof spaceRecord.directoryPath === 'string' ? spaceRecord.directoryPath : workspacePathRaw
      const directoryPath =
        normalizeWorkspacePathForMatch(directoryPathRaw, platform) || workspacePath

      candidates.push({
        id,
        directoryPath,
        workspacePath,
      })
    }
  }

  if (candidates.length === 0) {
    return null
  }

  const directCandidates = candidates
    .filter(candidate => isPathWithinRoot(candidate.directoryPath, normalizedCwd, platform))
    .sort((a, b) => b.directoryPath.length - a.directoryPath.length)

  if (directCandidates.length > 0) {
    return directCandidates[0]?.id ?? null
  }

  const workspaceCandidates = candidates
    .filter(candidate => isPathWithinRoot(candidate.workspacePath, normalizedCwd, platform))
    .sort((a, b) => b.workspacePath.length - a.workspacePath.length)

  if (workspaceCandidates.length > 0) {
    return workspaceCandidates[0]?.id ?? null
  }

  const uniqueSpaceIds = [...new Set(candidates.map(candidate => candidate.id))]
  if (uniqueSpaceIds.length === 1) {
    return uniqueSpaceIds[0] ?? null
  }

  return null
}

export function createUnsupportedUpdateState(): AppUpdateState {
  return {
    policy: 'off',
    channel: 'stable',
    currentVersion: 'web',
    status: 'unsupported',
    latestVersion: null,
    releaseName: null,
    releaseDate: null,
    releaseNotesUrl: null,
    downloadPercent: null,
    downloadedBytes: null,
    totalBytes: null,
    checkedAt: null,
    message: 'Updates are unavailable in browser runtime.',
  }
}

export function unsupportedWorkerStatus(): WorkerStatusResult {
  return {
    status: 'running',
    connection: null,
  }
}

export function unsupportedCliStatus(): CliPathStatusResult {
  return {
    installed: false,
    path: null,
  }
}

export function unsupportedWorkerConfig(): HomeWorkerConfigDto {
  return {
    version: 1,
    mode: 'remote',
    remote: null,
    updatedAt: null,
  }
}

export function unsupportedReleaseNotes(): ReleaseNotesCurrentResult {
  return {
    currentVersion: 'web',
    channel: 'stable',
    publishedAt: null,
    provenance: 'fallback',
    summary: null,
    compareUrl: null,
    items: [],
  }
}

export function unsupportedPathOpeners(): ListWorkspacePathOpenersResult {
  return {
    openers: [],
  }
}

export function isPersistedAppState(value: unknown): value is PersistedAppState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.formatVersion === 'number' &&
    Array.isArray(record.workspaces) &&
    typeof record.settings === 'object' &&
    record.settings !== null
  )
}

function mergeNodes(
  baseNodes: PersistedTerminalNode[],
  localNodes: PersistedTerminalNode[],
): PersistedTerminalNode[] {
  const localById = new Map(localNodes.map(node => [node.id, node] as const))
  const seen = new Set<string>()
  const merged: PersistedTerminalNode[] = []

  for (const baseNode of baseNodes) {
    merged.push(localById.get(baseNode.id) ?? baseNode)
    seen.add(baseNode.id)
  }

  for (const localNode of localNodes) {
    if (seen.has(localNode.id)) {
      continue
    }

    merged.push(localNode)
  }

  return merged
}

function mergeSpaces(options: {
  baseSpaces: WorkspaceSpaceState[]
  localSpaces: WorkspaceSpaceState[]
  validNodeIds: Set<string>
}): WorkspaceSpaceState[] {
  const localSpaceById = new Map(options.localSpaces.map(space => [space.id, space] as const))
  const baseSpaceIds = new Set(options.baseSpaces.map(space => space.id))
  const assignmentByNodeId = new Map<string, string>()

  for (const space of options.baseSpaces) {
    for (const nodeId of space.nodeIds) {
      if (!options.validNodeIds.has(nodeId)) {
        continue
      }

      if (!assignmentByNodeId.has(nodeId)) {
        assignmentByNodeId.set(nodeId, space.id)
      }
    }
  }

  for (const space of options.localSpaces) {
    for (const nodeId of space.nodeIds) {
      if (!options.validNodeIds.has(nodeId)) {
        continue
      }

      assignmentByNodeId.set(nodeId, space.id)
    }
  }

  const mergedSpaces: WorkspaceSpaceState[] = []

  for (const baseSpace of options.baseSpaces) {
    const localSpace = localSpaceById.get(baseSpace.id) ?? null

    const baseOrder = baseSpace.nodeIds.filter(
      nodeId => assignmentByNodeId.get(nodeId) === baseSpace.id && options.validNodeIds.has(nodeId),
    )
    const localOrder = localSpace
      ? localSpace.nodeIds.filter(
          nodeId =>
            assignmentByNodeId.get(nodeId) === baseSpace.id &&
            options.validNodeIds.has(nodeId) &&
            !baseOrder.includes(nodeId),
        )
      : []

    const nodeIds = [...new Set([...baseOrder, ...localOrder])]
    mergedSpaces.push({
      ...(localSpace ? { ...baseSpace, ...localSpace } : baseSpace),
      nodeIds,
    })
  }

  for (const localSpace of options.localSpaces) {
    if (baseSpaceIds.has(localSpace.id)) {
      continue
    }

    const nodeIds = [
      ...new Set(
        localSpace.nodeIds.filter(
          nodeId =>
            assignmentByNodeId.get(nodeId) === localSpace.id && options.validNodeIds.has(nodeId),
        ),
      ),
    ]

    mergedSpaces.push({ ...localSpace, nodeIds })
  }

  if (mergedSpaces.length === 0) {
    return mergedSpaces
  }

  const knownSpaceIds = new Set(mergedSpaces.map(space => space.id))
  const orphanNodeIds: string[] = []

  for (const [nodeId, spaceId] of assignmentByNodeId.entries()) {
    if (!knownSpaceIds.has(spaceId)) {
      orphanNodeIds.push(nodeId)
    }
  }

  if (orphanNodeIds.length === 0) {
    return mergedSpaces
  }

  const first = mergedSpaces[0]
  mergedSpaces[0] = {
    ...first,
    nodeIds: [...new Set([...first.nodeIds, ...orphanNodeIds])],
  }

  return mergedSpaces
}

function mergeWorkspaces(
  base: PersistedWorkspaceState,
  local: PersistedWorkspaceState,
): PersistedWorkspaceState {
  const nodes = mergeNodes(base.nodes, local.nodes)
  const validNodeIds = new Set(nodes.map(node => node.id))

  return {
    ...base,
    ...local,
    nodes,
    spaces: mergeSpaces({ baseSpaces: base.spaces, localSpaces: local.spaces, validNodeIds }),
    viewport: base.viewport,
    isMinimapVisible: base.isMinimapVisible,
    activeSpaceId: base.activeSpaceId,
  }
}

export function mergePersistedAppStates(
  base: PersistedAppState,
  local: PersistedAppState,
): PersistedAppState {
  const localWorkspaceById = new Map(
    local.workspaces.map(workspace => [workspace.id, workspace] as const),
  )
  const baseWorkspaceIds = new Set(base.workspaces.map(workspace => workspace.id))

  const mergedWorkspaces = base.workspaces.map(workspace => {
    const localWorkspace = localWorkspaceById.get(workspace.id)
    return localWorkspace ? mergeWorkspaces(workspace, localWorkspace) : workspace
  })

  for (const localWorkspace of local.workspaces) {
    if (baseWorkspaceIds.has(localWorkspace.id)) {
      continue
    }

    mergedWorkspaces.push(localWorkspace)
  }

  return {
    ...base,
    ...local,
    activeWorkspaceId: base.activeWorkspaceId,
    workspaces: mergedWorkspaces,
  }
}
