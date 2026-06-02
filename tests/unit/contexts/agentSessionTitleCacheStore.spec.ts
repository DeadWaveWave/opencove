import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionTitleCacheStore } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionTitleCacheStore'

interface MockRow {
  mtimeMs: number
  size: number
  valueJson: string
}

// 仿 browserProfileStore.spec.ts:mock better-sqlite3 + migrate,避免在 vitest 下加载
// 为 Electron ABI 编译的原生模块。只需模拟本 store 用到的几条语句。
class MockDatabase {
  private readonly rows = new Map<string, MockRow>()

  prepare(sql: string): {
    get: (...a: unknown[]) => unknown
    all: () => unknown[]
    run: (...a: unknown[]) => void
  } {
    const rows = this.rows
    return {
      get: (...args: unknown[]) => {
        if (sql.includes('SELECT mtime_ms')) {
          const row = rows.get(String(args[0]))
          return row
            ? { mtime_ms: row.mtimeMs, size: row.size, value_json: row.valueJson }
            : undefined
        }

        return undefined
      },
      all: () => {
        if (sql.includes('SELECT file_path FROM')) {
          return Array.from(rows.keys()).map(filePath => ({ file_path: filePath }))
        }

        return []
      },
      run: (...args: unknown[]) => {
        if (sql.includes('INSERT INTO agent_session_title_cache')) {
          rows.set(String(args[0]), {
            mtimeMs: Number(args[2]),
            size: Number(args[3]),
            valueJson: String(args[4]),
          })
        } else if (sql.includes('DELETE FROM agent_session_title_cache')) {
          rows.delete(String(args[0]))
        }
      },
    }
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return ((...args: never[]) => fn(...args)) as T
  }

  close(): void {
    // no-op
  }
}

vi.mock('../../../src/platform/persistence/sqlite/migrate', () => ({ migrate: vi.fn() }))
vi.mock('better-sqlite3', () => ({ default: MockDatabase }))

describe('AgentSessionTitleCacheStore', () => {
  const tempDirectories: string[] = []
  const stores: AgentSessionTitleCacheStore[] = []

  afterEach(async () => {
    for (const store of stores.splice(0)) {
      store.dispose()
    }
    await Promise.all(
      tempDirectories.splice(0).map(async directory => {
        await rm(directory, { recursive: true, force: true })
      }),
    )
  })

  async function createStore(): Promise<{ store: AgentSessionTitleCacheStore; directory: string }> {
    const directory = await mkdtemp(path.join(tmpdir(), 'opencove-title-cache-'))
    tempDirectories.push(directory)
    const { createAgentSessionTitleCacheStore } =
      await import('../../../src/contexts/agent/infrastructure/cli/AgentSessionTitleCacheStore')
    const store = await createAgentSessionTitleCacheStore({
      dbPath: path.join(directory, 'opencove.db'),
    })
    stores.push(store)
    return { store, directory }
  }

  it('returns a written value when the fingerprint matches', async () => {
    const { store } = await createStore()
    const fingerprint = { mtimeMs: 1000.5, size: 2048 }

    store.write({
      filePath: '/sessions/a.jsonl',
      provider: 'claude-code',
      fingerprint,
      value: { title: 'Fix flaky tests', preview: 'Investigate the flaky suite' },
    })

    expect(store.read('/sessions/a.jsonl', fingerprint)).toEqual({
      value: { title: 'Fix flaky tests', preview: 'Investigate the flaky suite' },
    })
  })

  it('treats a changed fingerprint as a miss', async () => {
    const { store } = await createStore()
    store.write({
      filePath: '/sessions/a.jsonl',
      provider: 'codex',
      fingerprint: { mtimeMs: 1000, size: 2048 },
      value: 'Inspect rollout records',
    })

    expect(store.read('/sessions/a.jsonl', { mtimeMs: 1000, size: 4096 })).toBeNull()
    expect(store.read('/sessions/a.jsonl', { mtimeMs: 2000, size: 2048 })).toBeNull()
    expect(store.read('/sessions/missing.jsonl', { mtimeMs: 1000, size: 2048 })).toBeNull()
  })

  it('distinguishes a cached null value from a miss', async () => {
    const { store } = await createStore()
    const fingerprint = { mtimeMs: 1, size: 1 }
    store.write({ filePath: '/sessions/empty.jsonl', provider: 'gemini', fingerprint, value: null })

    expect(store.read('/sessions/empty.jsonl', fingerprint)).toEqual({ value: null })
  })

  it('overwrites an existing row on conflict', async () => {
    const { store } = await createStore()
    store.write({
      filePath: '/sessions/a.jsonl',
      provider: 'claude-code',
      fingerprint: { mtimeMs: 1, size: 1 },
      value: { title: 'old' },
    })
    store.write({
      filePath: '/sessions/a.jsonl',
      provider: 'claude-code',
      fingerprint: { mtimeMs: 2, size: 2 },
      value: { title: 'new' },
    })

    expect(store.read('/sessions/a.jsonl', { mtimeMs: 1, size: 1 })).toBeNull()
    expect(store.read('/sessions/a.jsonl', { mtimeMs: 2, size: 2 })).toEqual({
      value: { title: 'new' },
    })
  })

  it('prunes rows whose files no longer exist on disk', async () => {
    const { store, directory } = await createStore()
    const existingFile = path.join(directory, 'present.jsonl')
    await writeFile(existingFile, '{}\n', 'utf8')
    const missingFile = path.join(directory, 'gone.jsonl')

    const fingerprint = { mtimeMs: 1, size: 1 }
    store.write({
      filePath: existingFile,
      provider: 'claude-code',
      fingerprint,
      value: { title: 'keep' },
    })
    store.write({
      filePath: missingFile,
      provider: 'claude-code',
      fingerprint,
      value: { title: 'drop' },
    })

    expect(store.pruneMissing()).toBe(1)
    expect(store.read(existingFile, fingerprint)).toEqual({ value: { title: 'keep' } })
    expect(store.read(missingFile, fingerprint)).toBeNull()
  })
})
