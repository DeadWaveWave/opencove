import type {
  AppUpdateState,
  CliPathStatusResult,
  HomeWorkerConfigDto,
  ListWorkspacePathOpenersResult,
  ReleaseNotesCurrentResult,
  WorkerStatusResult,
} from '@shared/contracts/dto'
export { isPersistedAppState, mergePersistedAppStates } from '@shared/sync/mergePersistedAppStates'

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
    webUi: {
      enabled: false,
      port: null,
      exposeOnLan: false,
      passwordSet: false,
    },
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
