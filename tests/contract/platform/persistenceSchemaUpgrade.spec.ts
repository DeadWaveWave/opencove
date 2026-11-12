// @vitest-environment node
import type Database from 'better-sqlite3'
import { beforeEach, expect, it, vi } from 'vitest'
import { DB_SCHEMA_VERSION } from '../../../src/platform/persistence/sqlite/constants'

const writers = vi.hoisted(() => ({ state: vi.fn(), scrollbacks: vi.fn() }))
vi.mock('../../../src/platform/persistence/sqlite/write', () => ({
  writeNormalizedAppState: writers.state,
  writeNormalizedScrollbacks: writers.scrollbacks,
}))
beforeEach(() => vi.resetAllMocks())

function fixture(version: number, legacy = false) {
  const tables = new Set<string>()
  const events: string[] = []
  const statements: string[] = []
  const db = {
    pragma: (sql: string) => {
      if (sql === 'user_version') {
        return version
      }
      const next = sql.match(/^user_version = (\d+)$/)
      if (next) {
        version = Number(next[1])
      }
    },
    exec: (sql: string) => {
      statements.push(sql)
      for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) {
        tables.add(match[1])
        events.push(match[1])
      }
    },
    prepare: (sql: string) => ({
      all: () => [],
      get: () =>
        sql.includes('FROM kv') && legacy
          ? { value: JSON.stringify({ formatVersion: 1, workspaces: [], settings: {} }) }
          : { cnt: 1 },
      run: vi.fn(() => statements.push(sql)),
    }),
  } as unknown as Database.Database
  return { db, tables, events, statements, version: () => version }
}

function assertSideTables(f: ReturnType<typeof fixture>) {
  for (const table of [
    'managed_claude_resume_bindings',
    'retired_managed_nodes',
    'node_lineage',
    'task_field_authority',
    'task_command_receipts',
    'task_claim_holders',
  ]) {
    expect(f.tables.has(table), table).toBe(true)
  }
  expect(f.events.indexOf('managed_claude_resume_bindings')).toBeLessThan(
    f.events.indexOf('node_lineage'),
  )
  expect(f.events.indexOf('retired_managed_nodes')).toBeLessThan(f.events.indexOf('node_lineage'))
}

it('retains schema 15 for additive dormant task authority tables', () => {
  expect(DB_SCHEMA_VERSION).toBe(15)
})

it('models v13 without either feature and v14 with only the managed Claude ledger', async () => {
  const { createInstalledUpgradeState } = await import('./persistenceInstalledUpgradeSupport')
  const old = createInstalledUpgradeState(13).tables
  expect(old.has('managed_claude_resume_bindings')).toBe(false)
  expect(old.has('retired_managed_nodes')).toBe(false)
  expect(old.has('node_lineage')).toBe(false)
  const ledger = createInstalledUpgradeState(14).tables
  expect(ledger.has('managed_claude_resume_bindings')).toBe(true)
  expect(ledger.has('retired_managed_nodes')).toBe(true)
  expect(ledger.has('terminal_recovery_records')).toBe(true)
  expect(ledger.get('nodes')).toContain('worker_binding_json')
  expect(ledger.has('node_lineage')).toBe(false)
})

it.each([13, 14, 15])('upgrades or repairs v%s without inferring owner rows', async version => {
  const { migrate } = await import('../../../src/platform/persistence/sqlite/migrate')
  const f = fixture(version)
  migrate(f.db)
  expect(f.version()).toBe(15)
  assertSideTables(f)
  expect(f.statements.join('\n')).not.toMatch(
    /INSERT\s+INTO\s+(node_lineage|managed_claude_resume_bindings|retired_managed_nodes)/i,
  )
  expect(writers.state).not.toHaveBeenCalled()
  expect(writers.scrollbacks).not.toHaveBeenCalled()
})

it('creates both side-table sets before the v1 legacy writer', async () => {
  const { migrate } = await import('../../../src/platform/persistence/sqlite/migrate')
  const f = fixture(1, true)
  writers.state.mockImplementation(db => {
    expect(db).toBe(f.db)
    assertSideTables(f)
    f.events.push('legacy-writer')
  })
  migrate(f.db)
  expect(writers.state).toHaveBeenCalledExactlyOnceWith(
    f.db,
    expect.objectContaining({ formatVersion: 1 }),
  )
  expect(writers.scrollbacks).toHaveBeenCalledOnce()
  expect(f.events.indexOf('node_lineage')).toBeLessThan(f.events.indexOf('legacy-writer'))
  expect(f.version()).toBe(15)
})

it('refuses a newer schema before any repair or write', async () => {
  const { migrate } = await import('../../../src/platform/persistence/sqlite/migrate')
  const f = fixture(DB_SCHEMA_VERSION + 1)
  expect(() => migrate(f.db)).toThrow('requires a newer OpenCove version')
  expect(f.statements).toEqual([])
  expect(writers.state).not.toHaveBeenCalled()
})
