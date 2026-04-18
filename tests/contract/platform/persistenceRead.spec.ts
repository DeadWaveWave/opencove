import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { describe, expect, it } from 'vitest'
import { readAppStateFromDb } from '../../../src/platform/persistence/sqlite/read'
import {
  appMeta,
  appSettings,
  nodes,
  spaceNodes,
  spaces,
  workspaces,
} from '../../../src/platform/persistence/sqlite/schema'

type MetaRow = { key: 'format_version' | 'active_workspace_id'; value: string }
type SettingsRow = { id: number; value: string }
type WorkspaceRow = {
  id: string
  name: string
  path: string
  worktreesRoot: string
  pullRequestBaseBranchOptionsJson: string
  spaceArchiveRecordsJson: string
  viewportX: number
  viewportY: number
  viewportZoom: number
  isMinimapVisible: boolean
  activeSpaceId: string | null
  sortOrder: number
}

function createReadDb(options: {
  metaRows: MetaRow[]
  settingsRow: SettingsRow | undefined
  workspaceRows: WorkspaceRow[]
}): BetterSQLite3Database {
  const db = {
    select(selection?: unknown) {
      return {
        from(table: unknown) {
          if (table === appMeta) {
            return {
              all: () => options.metaRows,
            }
          }

          if (table === appSettings) {
            return {
              where: (_predicate: unknown) => ({
                get: () => {
                  if (!options.settingsRow) {
                    return undefined
                  }

                  return selection
                    ? {
                        value: options.settingsRow.value,
                      }
                    : options.settingsRow
                },
              }),
            }
          }

          if (table === workspaces) {
            return {
              all: () => options.workspaceRows,
              orderBy: (_column: unknown) => ({
                all: () =>
                  [...options.workspaceRows].sort(
                    (left, right) => left.sortOrder - right.sortOrder,
                  ),
              }),
            }
          }

          if (table === nodes || table === spaces || table === spaceNodes) {
            return {
              all: () => [],
            }
          }

          throw new Error('Unexpected table')
        },
      }
    },
  }

  return db as BetterSQLite3Database
}

describe('sqlite persistence read', () => {
  it('loads workspaces in ascending sort_order', () => {
    const db = createReadDb({
      metaRows: [
        { key: 'format_version', value: '1' },
        { key: 'active_workspace_id', value: 'workspace-1' },
      ],
      settingsRow: { id: 1, value: '{}' },
      workspaceRows: [
        {
          id: 'workspace-2',
          name: 'Workspace 2',
          path: '/tmp/workspace-2',
          worktreesRoot: '/tmp/worktrees',
          pullRequestBaseBranchOptionsJson: '[]',
          spaceArchiveRecordsJson: '[]',
          viewportX: 0,
          viewportY: 0,
          viewportZoom: 1,
          isMinimapVisible: true,
          activeSpaceId: null,
          sortOrder: 2,
        },
        {
          id: 'workspace-1',
          name: 'Workspace 1',
          path: '/tmp/workspace-1',
          worktreesRoot: '/tmp/worktrees',
          pullRequestBaseBranchOptionsJson: '[]',
          spaceArchiveRecordsJson: '[]',
          viewportX: 0,
          viewportY: 0,
          viewportZoom: 1,
          isMinimapVisible: true,
          activeSpaceId: null,
          sortOrder: 1,
        },
      ],
    })

    const appState = readAppStateFromDb(db)

    expect(appState?.workspaces.map(workspace => workspace.id)).toEqual([
      'workspace-1',
      'workspace-2',
    ])
  })
})
