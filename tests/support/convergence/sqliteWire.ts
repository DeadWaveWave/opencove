import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { normalizePersistedAppState } from '@platform/persistence/sqlite/normalize'
import { readAppStateFromDb } from '@platform/persistence/sqlite/read'
import {
  appMeta,
  appSettings,
  workspaces,
  nodes,
  spaces,
  spaceNodes,
  managedClaudeResumeBindings,
} from '@platform/persistence/sqlite/schema'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
/** Use SQLite's real reader over row data, not a guessed renderer-shaped response.
 * A native contract independently compares this row bridge with a real SQLite round trip. */
export function sqliteWireState(input: PersistedAppState): PersistedAppState {
  const normalized = normalizePersistedAppState(input)!
  const collapse = Object.fromEntries(
    normalized.workspaces
      .filter(w => w.collapsedNodeIds !== undefined || w.collapsedSpaceIds !== undefined)
      .map(w => [
        w.id,
        {
          collapsedNodeIds: w.collapsedNodeIds ?? [],
          collapsedSpaceIds: w.collapsedSpaceIds ?? [],
        },
      ]),
  )
  const rows = new Map<unknown, unknown[]>([
    [
      appMeta,
      [
        { key: 'format_version', value: String(normalized.formatVersion) },
        { key: 'active_workspace_id', value: normalized.activeWorkspaceId ?? '' },
        { key: 'canvas_collapse_state', value: JSON.stringify(collapse) },
      ],
    ],
    [appSettings, [{ id: 1, value: JSON.stringify(normalized.settings) }]],
    [
      workspaces,
      normalized.workspaces.map((w, sortOrder) => ({
        ...w,
        sortOrder,
        pullRequestBaseBranchOptionsJson: JSON.stringify(w.pullRequestBaseBranchOptions),
        environmentVariablesJson: JSON.stringify(w.environmentVariables),
        spaceArchiveRecordsJson: JSON.stringify(w.spaceArchiveRecords),
        viewportX: w.viewport.x,
        viewportY: w.viewport.y,
        viewportZoom: w.viewport.zoom,
      })),
    ],
    [
      nodes,
      normalized.workspaces.flatMap(w =>
        w.nodes.map(n => ({
          ...n,
          workspaceId: w.id,
          titlePinnedByUser: n.titlePinnedByUser ? 1 : 0,
          titleIsLiteral: n.titleIsLiteral ? 1 : 0,
          positionX: n.position.x,
          positionY: n.position.y,
          agentJson: JSON.stringify(n.agent),
          taskJson: JSON.stringify(n.task),
          terminalGeometryJson: JSON.stringify(n.terminalGeometry),
          workerBindingJson: JSON.stringify(n.workerBinding),
        })),
      ),
    ],
    [
      spaces,
      normalized.workspaces.flatMap(w =>
        w.spaces.map((s, sortOrder) => ({
          ...s,
          workspaceId: w.id,
          sortOrder: s.sortOrder ?? sortOrder,
          boundaryJson: JSON.stringify(s.boundary),
          rectX: s.rect?.x ?? null,
          rectY: s.rect?.y ?? null,
          rectWidth: s.rect?.width ?? null,
          rectHeight: s.rect?.height ?? null,
        })),
      ),
    ],
    [
      spaceNodes,
      normalized.workspaces.flatMap(w =>
        w.spaces.flatMap(s =>
          s.nodeIds.map((nodeId, sortOrder) => ({ spaceId: s.id, nodeId, sortOrder })),
        ),
      ),
    ],
    [
      managedClaudeResumeBindings,
      normalized.workspaces.flatMap(w =>
        w.nodes
          .filter(n => n.managedClaudeResumeBindingOwnership)
          .map(n => ({ nodeId: n.id, ...n.managedClaudeResumeBindingOwnership })),
      ),
    ],
  ])
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const query = {
          all: () => rows.get(table) ?? [],
          get: () => rows.get(table)?.[0],
          where: () => query,
          orderBy: () => query,
        }
        return query
      },
    }),
  } as unknown as BetterSQLite3Database
  return readAppStateFromDb(db) as PersistedAppState
}
