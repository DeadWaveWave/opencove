import { MAX_PERSISTED_SCROLLBACK_CHARS } from './constants'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeNullableString(value: unknown): string | null {
  return value === null ? null : typeof value === 'string' ? value : null
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeScrollback(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  if (value.length === 0) {
    return null
  }

  if (value.length <= MAX_PERSISTED_SCROLLBACK_CHARS) {
    return value
  }

  return value.slice(-MAX_PERSISTED_SCROLLBACK_CHARS)
}

export type NormalizedPersistedNode = {
  id: string
  title: string
  titlePinnedByUser?: boolean
  position: { x: number; y: number }
  width: number
  height: number
  kind: string
  status: string | null
  startedAt: string | null
  endedAt: string | null
  exitCode: number | null
  lastError: string | null
  executionDirectory?: string | null
  expectedDirectory?: string | null
  agent: unknown | null
  task: unknown | null
  scrollback: string | null
}

export type NormalizedPersistedSpace = {
  id: string
  name: string
  directoryPath: string
  nodeIds: string[]
  rect: { x: number; y: number; width: number; height: number } | null
}

export type NormalizedPersistedWorkspace = {
  id: string
  name: string
  path: string
  worktreesRoot: string
  pullRequestBaseBranchOptions: string[]
  viewport: { x: number; y: number; zoom: number }
  isMinimapVisible: boolean
  spaces: NormalizedPersistedSpace[]
  activeSpaceId: string | null
  nodes: NormalizedPersistedNode[]
}

export type NormalizedPersistedAppState = {
  formatVersion: number
  activeWorkspaceId: string | null
  workspaces: NormalizedPersistedWorkspace[]
  settings: unknown
}

function normalizeViewport(value: unknown): { x: number; y: number; zoom: number } {
  if (!isRecord(value)) {
    return { x: 0, y: 0, zoom: 1 }
  }

  return {
    x: normalizeFiniteNumber(value.x, 0),
    y: normalizeFiniteNumber(value.y, 0),
    zoom: Math.max(0.01, normalizeFiniteNumber(value.zoom, 1)),
  }
}

function normalizeRect(
  value: unknown,
): { x: number; y: number; width: number; height: number } | null {
  if (!isRecord(value)) {
    return null
  }

  const x = value.x
  const y = value.y
  const width = value.width
  const height = value.height
  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    typeof height !== 'number' ||
    !Number.isFinite(height)
  ) {
    return null
  }

  return { x, y, width, height }
}

function normalizeNodeIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0)
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  return [...new Set(normalized)].slice(0, 50)
}

export function normalizePersistedAppState(value: unknown): NormalizedPersistedAppState | null {
  if (!isRecord(value)) {
    return null
  }

  const formatVersionRaw = value.formatVersion
  const formatVersion =
    typeof formatVersionRaw === 'number' && Number.isFinite(formatVersionRaw)
      ? Math.max(0, Math.floor(formatVersionRaw))
      : 1

  const activeWorkspaceId = normalizeNullableString(value.activeWorkspaceId)
  const workspacesInput = Array.isArray(value.workspaces) ? value.workspaces : []
  const normalizedWorkspaces: NormalizedPersistedWorkspace[] = []

  for (const workspace of workspacesInput) {
    if (!isRecord(workspace)) {
      continue
    }

    const id = normalizeString(workspace.id).trim()
    if (id.length === 0) {
      continue
    }

    const nodesInput = Array.isArray(workspace.nodes) ? workspace.nodes : []
    const normalizedNodes: NormalizedPersistedNode[] = []

    for (const node of nodesInput) {
      if (!isRecord(node)) {
        continue
      }

      const nodeId = normalizeString(node.id).trim()
      if (nodeId.length === 0) {
        continue
      }

      const position = isRecord(node.position)
        ? {
            x: normalizeFiniteNumber(node.position.x, 0),
            y: normalizeFiniteNumber(node.position.y, 0),
          }
        : { x: 0, y: 0 }

      normalizedNodes.push({
        id: nodeId,
        title: normalizeString(node.title),
        titlePinnedByUser: node.titlePinnedByUser === true,
        position,
        width: normalizeFiniteNumber(node.width, 0),
        height: normalizeFiniteNumber(node.height, 0),
        kind: normalizeString(node.kind, 'terminal'),
        status: typeof node.status === 'string' ? node.status : null,
        startedAt: typeof node.startedAt === 'string' ? node.startedAt : null,
        endedAt: typeof node.endedAt === 'string' ? node.endedAt : null,
        exitCode:
          typeof node.exitCode === 'number' && Number.isFinite(node.exitCode)
            ? node.exitCode
            : null,
        lastError: typeof node.lastError === 'string' ? node.lastError : null,
        executionDirectory:
          typeof node.executionDirectory === 'string' ? node.executionDirectory : null,
        expectedDirectory:
          typeof node.expectedDirectory === 'string' ? node.expectedDirectory : null,
        agent: isRecord(node.agent) ? node.agent : null,
        task: isRecord(node.task) ? node.task : null,
        scrollback: normalizeScrollback(node.scrollback),
      })
    }

    const spacesInput = Array.isArray(workspace.spaces) ? workspace.spaces : []
    const normalizedSpaces: NormalizedPersistedSpace[] = []

    for (const space of spacesInput) {
      if (!isRecord(space)) {
        continue
      }

      const spaceId = normalizeString(space.id).trim()
      if (spaceId.length === 0) {
        continue
      }

      normalizedSpaces.push({
        id: spaceId,
        name: normalizeString(space.name),
        directoryPath: normalizeString(space.directoryPath),
        nodeIds: normalizeNodeIds(space.nodeIds),
        rect: normalizeRect(space.rect),
      })
    }

    normalizedWorkspaces.push({
      id,
      name: normalizeString(workspace.name),
      path: normalizeString(workspace.path),
      worktreesRoot: normalizeString(workspace.worktreesRoot),
      pullRequestBaseBranchOptions: normalizeStringArray(workspace.pullRequestBaseBranchOptions),
      viewport: normalizeViewport(workspace.viewport),
      isMinimapVisible: normalizeBoolean(workspace.isMinimapVisible, true),
      spaces: normalizedSpaces,
      activeSpaceId:
        typeof workspace.activeSpaceId === 'string' && workspace.activeSpaceId.length > 0
          ? workspace.activeSpaceId
          : null,
      nodes: normalizedNodes,
    })
  }

  return {
    formatVersion,
    activeWorkspaceId,
    workspaces: normalizedWorkspaces,
    settings: value.settings ?? {},
  }
}
