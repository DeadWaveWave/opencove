import type Database from 'better-sqlite3'
import type { DbAppMetaKey } from './schema'
import type { NormalizedPersistedAppState } from './normalize'
import { normalizeScrollback } from './normalize'
import { safeJsonStringify } from './utils'

export function writeNormalizedAppState(
  db: Database.Database,
  state: NormalizedPersistedAppState,
): number {
  const readMetaValue = db.prepare(
    `
      SELECT value
      FROM app_meta
      WHERE key = ?
      LIMIT 1
    `,
  )

  const upsertMeta = db.prepare(
    `
      INSERT INTO app_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
  )
  const upsertSettings = db.prepare(
    `
      INSERT INTO app_settings (id, value)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value
    `,
  )

  const insertWorkspace = db.prepare(
    `
      INSERT INTO workspaces (
        id, name, path, worktrees_root, pull_request_base_branch_options_json, space_archive_records_json,
        viewport_x, viewport_y, viewport_zoom,
        is_minimap_visible, active_space_id, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )

  const insertNode = db.prepare(
    `
      INSERT INTO nodes (
        id, workspace_id, session_id, title, title_pinned_by_user,
        position_x, position_y, width, height,
        kind, label_color_override,
        status, started_at, ended_at, exit_code, last_error,
        execution_directory, expected_directory, agent_json, task_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )

  const insertSpace = db.prepare(
    `
      INSERT INTO workspace_spaces (
        id, workspace_id, name, directory_path, target_mount_id, label_color,
        rect_x, rect_y, rect_width, rect_height
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )

  const insertSpaceNode = db.prepare(
    `
      INSERT INTO workspace_space_nodes (space_id, node_id, sort_order)
      VALUES (?, ?, ?)
    `,
  )

  const writeTx = db.transaction(() => {
    const currentRevisionRaw = readMetaValue.get('app_state_revision' satisfies DbAppMetaKey) as
      | { value?: unknown }
      | undefined
    const currentRevision =
      typeof currentRevisionRaw?.value === 'string'
        ? Number.parseInt(currentRevisionRaw.value, 10)
        : 0
    const nextRevision =
      Number.isFinite(currentRevision) && currentRevision >= 0 ? currentRevision + 1 : 1

    db.exec(`
      DELETE FROM workspace_space_nodes;
      DELETE FROM workspace_spaces;
      DELETE FROM nodes;
      DELETE FROM workspaces;
    `)

    upsertMeta.run('format_version' satisfies DbAppMetaKey, String(state.formatVersion))
    upsertMeta.run('active_workspace_id' satisfies DbAppMetaKey, state.activeWorkspaceId ?? '')
    upsertMeta.run('app_state_revision' satisfies DbAppMetaKey, String(nextRevision))

    upsertSettings.run(safeJsonStringify(state.settings ?? {}))

    for (let sortOrder = 0; sortOrder < state.workspaces.length; sortOrder += 1) {
      const workspace = state.workspaces[sortOrder]
      insertWorkspace.run(
        workspace.id,
        workspace.name,
        workspace.path,
        workspace.worktreesRoot,
        safeJsonStringify(workspace.pullRequestBaseBranchOptions),
        safeJsonStringify(workspace.spaceArchiveRecords),
        workspace.viewport.x,
        workspace.viewport.y,
        workspace.viewport.zoom,
        workspace.isMinimapVisible ? 1 : 0,
        workspace.activeSpaceId,
        sortOrder,
      )

      for (const node of workspace.nodes) {
        insertNode.run(
          node.id,
          workspace.id,
          node.sessionId ?? null,
          node.title,
          node.titlePinnedByUser === true ? 1 : 0,
          node.position.x,
          node.position.y,
          node.width,
          node.height,
          node.kind,
          node.labelColorOverride,
          node.status,
          node.startedAt,
          node.endedAt,
          node.exitCode,
          node.lastError,
          node.executionDirectory ?? null,
          node.expectedDirectory ?? null,
          node.agent ? safeJsonStringify(node.agent) : null,
          node.task ? safeJsonStringify(node.task) : null,
        )
      }

      for (const space of workspace.spaces) {
        insertSpace.run(
          space.id,
          workspace.id,
          space.name,
          space.directoryPath,
          space.targetMountId,
          space.labelColor,
          space.rect?.x ?? null,
          space.rect?.y ?? null,
          space.rect?.width ?? null,
          space.rect?.height ?? null,
        )

        space.nodeIds.forEach((nodeId, index) => {
          insertSpaceNode.run(space.id, nodeId, index)
        })
      }
    }

    // Keep scrollback only for still-present nodes.
    db.exec('DELETE FROM node_scrollback WHERE node_id NOT IN (SELECT id FROM nodes)')

    return nextRevision
  })

  return writeTx()
}

export function writeNormalizedScrollbacks(
  db: Database.Database,
  state: NormalizedPersistedAppState,
): void {
  const insertScrollback = db.prepare(
    `
      INSERT INTO node_scrollback (node_id, scrollback, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        scrollback = excluded.scrollback,
        updated_at = excluded.updated_at
    `,
  )

  const now = new Date().toISOString()

  const writeTx = db.transaction(() => {
    db.exec('DELETE FROM node_scrollback;')

    for (const workspace of state.workspaces) {
      for (const node of workspace.nodes) {
        const scrollback = normalizeScrollback(node.scrollback)
        if (!scrollback) {
          continue
        }

        insertScrollback.run(node.id, scrollback, now)
      }
    }
  })

  writeTx()
}
