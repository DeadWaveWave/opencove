import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq, inArray } from 'drizzle-orm'
import type { NormalizedPersistedAppState } from './normalize'
import {
  normalizeLabelColor,
  normalizeNodeLabelColorOverride,
} from '../../../shared/types/labelColor'
import {
  appMeta,
  appSettings,
  nodeScrollback,
  nodes,
  spaceNodes,
  spaces,
  workspaces,
} from './schema'
import { safeJsonParse } from './utils'

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  return [...new Set(normalized)].slice(0, 50)
}

export function readAppStateFromDb(db: BetterSQLite3Database): NormalizedPersistedAppState | null {
  const metaRows = db.select().from(appMeta).all()
  if (metaRows.length === 0) {
    return null
  }

  const meta = new Map(metaRows.map(row => [row.key, row.value] as const))
  const formatVersionRaw = meta.get('format_version') ?? '1'
  const formatVersion = Number.parseInt(formatVersionRaw, 10)
  const activeWorkspaceIdRaw = meta.get('active_workspace_id') ?? ''

  const settingsRow = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .get()
  const settingsValue =
    typeof settingsRow?.value === 'string' ? safeJsonParse(settingsRow.value) : {}

  const workspaceRows = db.select().from(workspaces).orderBy(workspaces.sortOrder).all()
  const nodeRows = db.select().from(nodes).all()
  const spaceRows = db.select().from(spaces).all()
  const spaceNodeRows = db.select().from(spaceNodes).all()

  const nodesByWorkspaceId = new Map<string, typeof nodeRows>()
  for (const node of nodeRows) {
    const bucket = nodesByWorkspaceId.get(node.workspaceId) ?? []
    bucket.push(node)
    nodesByWorkspaceId.set(node.workspaceId, bucket)
  }

  const spacesByWorkspaceId = new Map<string, typeof spaceRows>()
  for (const space of spaceRows) {
    const bucket = spacesByWorkspaceId.get(space.workspaceId) ?? []
    bucket.push(space)
    spacesByWorkspaceId.set(space.workspaceId, bucket)
  }

  const spaceNodesBySpaceId = new Map<string, typeof spaceNodeRows>()
  for (const link of spaceNodeRows) {
    const bucket = spaceNodesBySpaceId.get(link.spaceId) ?? []
    bucket.push(link)
    spaceNodesBySpaceId.set(link.spaceId, bucket)
  }

  return {
    formatVersion: Number.isFinite(formatVersion) ? formatVersion : 1,
    activeWorkspaceId: activeWorkspaceIdRaw.length > 0 ? activeWorkspaceIdRaw : null,
    workspaces: workspaceRows.map(workspace => {
      const workspaceNodes = (nodesByWorkspaceId.get(workspace.id) ?? []).map(node => ({
        id: node.id,
        sessionId:
          typeof node.sessionId === 'string' && node.sessionId.trim().length > 0
            ? node.sessionId
            : null,
        title: node.title,
        titlePinnedByUser: node.titlePinnedByUser === 1,
        position: { x: node.positionX, y: node.positionY },
        width: node.width,
        height: node.height,
        kind: node.kind,
        labelColorOverride: normalizeNodeLabelColorOverride(node.labelColorOverride),
        status: node.status,
        startedAt: node.startedAt,
        endedAt: node.endedAt,
        exitCode: node.exitCode,
        lastError: node.lastError,
        scrollback: null,
        executionDirectory: node.executionDirectory,
        expectedDirectory: node.expectedDirectory,
        agent: typeof node.agentJson === 'string' ? safeJsonParse(node.agentJson) : null,
        task: typeof node.taskJson === 'string' ? safeJsonParse(node.taskJson) : null,
      }))

      const workspaceSpaces = (spacesByWorkspaceId.get(workspace.id) ?? []).map(space => {
        const links = [...(spaceNodesBySpaceId.get(space.id) ?? [])].sort(
          (left, right) => left.sortOrder - right.sortOrder,
        )

        return {
          id: space.id,
          name: space.name,
          directoryPath: space.directoryPath,
          targetMountId: typeof space.targetMountId === 'string' ? space.targetMountId : null,
          labelColor: normalizeLabelColor(space.labelColor),
          nodeIds: links.map(link => link.nodeId),
          rect:
            space.rectX !== null &&
            space.rectY !== null &&
            space.rectWidth !== null &&
            space.rectHeight !== null
              ? {
                  x: space.rectX,
                  y: space.rectY,
                  width: space.rectWidth,
                  height: space.rectHeight,
                }
              : null,
        }
      })

      const activeSpaceId =
        workspace.activeSpaceId &&
        workspaceSpaces.some(space => space.id === workspace.activeSpaceId)
          ? workspace.activeSpaceId
          : null

      return {
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        worktreesRoot: workspace.worktreesRoot,
        pullRequestBaseBranchOptions: normalizeStringArray(
          safeJsonParse(workspace.pullRequestBaseBranchOptionsJson),
        ),
        spaceArchiveRecords: (() => {
          const parsed = safeJsonParse(workspace.spaceArchiveRecordsJson)
          return Array.isArray(parsed) ? parsed.slice(0, 50) : []
        })(),
        viewport: { x: workspace.viewportX, y: workspace.viewportY, zoom: workspace.viewportZoom },
        isMinimapVisible: workspace.isMinimapVisible,
        spaces: workspaceSpaces,
        activeSpaceId,
        nodes: workspaceNodes,
      }
    }),
    settings: settingsValue,
  }
}

export function readWorkspaceStateRawFromDb(
  db: BetterSQLite3Database,
  appState: NormalizedPersistedAppState | null,
): string | null {
  if (!appState) {
    return null
  }

  const nodeIds = appState.workspaces.flatMap(workspace => workspace.nodes.map(node => node.id))
  const scrollbacks =
    nodeIds.length > 0
      ? db
          .select({ nodeId: nodeScrollback.nodeId, scrollback: nodeScrollback.scrollback })
          .from(nodeScrollback)
          .where(inArray(nodeScrollback.nodeId, nodeIds))
          .all()
      : []
  const scrollbackByNodeId = new Map(scrollbacks.map(row => [row.nodeId, row.scrollback] as const))

  const hydrated = {
    ...appState,
    workspaces: appState.workspaces.map(workspace => ({
      ...workspace,
      nodes: workspace.nodes.map(node => ({
        ...node,
        scrollback: scrollbackByNodeId.get(node.id) ?? null,
      })),
    })),
  }

  return JSON.stringify(hydrated)
}
