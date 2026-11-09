// @vitest-environment node
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { getTableColumns, getTableName, type Table } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { migrate } from '../../../src/platform/persistence/sqlite/migrate'
import { writeNormalizedAppState } from '../../../src/platform/persistence/sqlite/write'
import { readAppStateFromDb } from '../../../src/platform/persistence/sqlite/read'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toRuntimeNodes } from '../../../src/contexts/workspace/presentation/renderer/utils/nodeTransform'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { openWritableSqliteDb } from '../../support/sqlite'
import { createMinimalState } from '../controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

// Reuse the real SQLite loader used by transcript tests; no experimental import at collection.
async function database() {
  const sql = await openWritableSqliteDb(':memory:')
  const writeDb = {
    exec: (query: string) => sql.exec(query),
    prepare: (query: string) => sql.prepare(query),
    pragma: (query: string, options?: { simple: boolean }) => {
      if (!options?.simple) {
        sql.exec(`PRAGMA ${query}`)
        return
      }
      const rows = sql.prepare(`PRAGMA ${query}`).all()
      return Object.values(rows[0] ?? {})[0]
    },
    transaction: (callback: () => unknown) => () => {
      sql.exec('BEGIN')
      try {
        const result = callback()
        sql.exec('COMMIT')
        return result
      } catch (error) {
        sql.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as Database.Database
  // The synchronous read port selects Drizzle schema columns; all data comes from SQLite.
  const readDb = {
    select: (selection?: Record<string, { name: string }>) => ({
      from: (table: Table) => {
        const columns = selection ?? getTableColumns(table)
        const query = `SELECT ${Object.entries(columns)
          .map(([key, column]) => `"${column.name}" AS "${key}"`)
          .join(', ')} FROM "${getTableName(table)}"`
        const result = {
          all: () => sql.prepare(query).all(),
          get: () => sql.prepare(query).get(),
          where: () => result,
          orderBy: () => result,
        }
        return result
      },
    }),
  } as unknown as BetterSQLite3Database
  return { sql, writeDb, readDb }
}

it('repairs an old database and round-trips literal names through SQL, hydration and Renderer persistence', async () => {
  const db = await database()
  try {
    migrate(db.writeDb)
    // Model an installed database that predates the additive literal column.
    const columns = db.sql.prepare('PRAGMA table_info(nodes)').all()
    if (columns.some(column => column.name === 'title_is_literal')) {
      db.sql.exec('ALTER TABLE nodes DROP COLUMN title_is_literal')
    }
    db.sql.exec(
      "INSERT INTO nodes (id, workspace_id, title, title_pinned_by_user, position_x, position_y, width, height, kind) VALUES ('legacy', 'project', 'codex · Old', 1, 0, 0, 400, 300, 'agent')",
    )
    migrate(db.writeDb)
    expect(
      db.sql
        .prepare(
          "SELECT title, title_pinned_by_user, title_is_literal FROM nodes WHERE id = 'legacy'",
        )
        .get(),
    ).toMatchObject({ title: 'codex · Old', title_pinned_by_user: 1, title_is_literal: 0 })
    expect(db.sql.prepare('PRAGMA table_info(nodes)').all()).toContainEqual(
      expect.objectContaining({ name: 'title_is_literal', dflt_value: '0' }),
    )
    const state = createMinimalState('/repo', 'project', 'space')
    state.workspaces[0].nodes = [
      {
        id: 'agent',
        kind: 'agent',
        sessionId: 'session',
        title: 'codex · Reviewer',
        titlePinnedByUser: true,
        titleIsLiteral: true,
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        status: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        task: null,
        agent: null,
        scrollback: null,
        labelColorOverride: null,
      },
    ]
    const normalized = normalizePersistedAppState(state)!
    writeNormalizedAppState(db.writeDb, normalized)
    expect(db.sql.prepare('SELECT title, title_is_literal FROM nodes').get()).toMatchObject({
      title: 'codex · Reviewer',
      title_is_literal: 1,
    })
    const loaded = readAppStateFromDb(db.readDb)!
    expect(loaded.workspaces[0].nodes[0]).toMatchObject({
      title: 'codex · Reviewer',
      titlePinnedByUser: true,
      titleIsLiteral: true,
    })
    const ensured = ensurePersistedWorkspace(loaded.workspaces[0])!
    const persisted = toPersistedState(
      [{ ...ensured, nodes: toRuntimeNodes(ensured) }],
      'project',
      DEFAULT_AGENT_SETTINGS,
    )
    expect(persisted.workspaces[0].nodes[0]).toMatchObject({
      title: 'codex · Reviewer',
      titlePinnedByUser: true,
      titleIsLiteral: true,
    })
    const legacy = structuredClone(state)
    delete legacy.workspaces[0].nodes[0].titleIsLiteral
    writeNormalizedAppState(db.writeDb, normalizePersistedAppState(legacy)!)
    expect(readAppStateFromDb(db.readDb)!.workspaces[0].nodes[0].titleIsLiteral).toBe(false)
  } finally {
    db.sql.close()
  }
})
