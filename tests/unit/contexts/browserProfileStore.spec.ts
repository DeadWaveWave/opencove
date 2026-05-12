import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserProfileScopeInput } from '../../../src/shared/contracts/dto'

type Row = Record<string, unknown>

interface MockDbState {
  settings: Map<string, Row>
  history: Map<string, Row>
  bookmarks: Map<string, Row>
  downloads: Map<string, Row>
  permissions: Map<string, Row>
}

const dbStateByPath = new Map<string, MockDbState>()

vi.mock('../../../src/platform/persistence/sqlite/migrate', () => ({ migrate: vi.fn() }))
vi.mock('better-sqlite3', () => ({ default: MockDatabase }))

const sharedScope: BrowserProfileScopeInput = { sessionMode: 'shared', profileId: null }
const incognitoScope: BrowserProfileScopeInput = { sessionMode: 'incognito', profileId: null }
const profileScope: BrowserProfileScopeInput = { sessionMode: 'profile', profileId: 'docs' }

let tempDirs: string[] = []

function createState(): MockDbState {
  return {
    settings: new Map(),
    history: new Map(),
    bookmarks: new Map(),
    downloads: new Map(),
    permissions: new Map(),
  }
}

function stripLikePattern(value: unknown): string {
  return String(value ?? '')
    .replace(/^%|%$/g, '')
    .replaceAll('\\%', '%')
    .replaceAll('\\_', '_')
}

function byLastVisitedDesc(left: Row, right: Row): number {
  return String(right.last_visited_at ?? '').localeCompare(String(left.last_visited_at ?? ''))
}

function byUpdatedDesc(left: Row, right: Row): number {
  return String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? ''))
}

class MockDatabase {
  private readonly state: MockDbState

  public constructor(private readonly path: string) {
    const state = dbStateByPath.get(path) ?? createState()
    dbStateByPath.set(path, state)
    this.state = state
  }

  public exec(): void {}

  public close(): void {}

  public prepare(sql: string): {
    get: (...args: unknown[]) => Row | undefined
    all: (...args: unknown[]) => Row[]
    run: (...args: unknown[]) => void
  } {
    return {
      get: (...args: unknown[]) => this.get(sql, args),
      all: (...args: unknown[]) => this.all(sql, args),
      run: (...args: unknown[]) => this.run(sql, args),
    }
  }

  private get(sql: string, args: unknown[]): Row | undefined {
    if (sql.includes('SELECT homepage_url FROM browser_profile_settings')) {
      return this.state.settings.get(String(args[0]))
    }

    if (
      sql.includes('FROM browser_bookmarks') &&
      sql.includes('WHERE profile_key = ? AND url = ?')
    ) {
      return this.state.bookmarks.get(`${String(args[0])}|${String(args[1])}`)
    }

    if (sql.includes('SELECT * FROM browser_downloads WHERE id = ?')) {
      return this.state.downloads.get(String(args[0]))
    }

    if (sql.includes('SELECT decision') && sql.includes('FROM browser_permission_decisions')) {
      return this.state.permissions.get(`${String(args[0])}|${String(args[1])}|${String(args[2])}`)
    }

    if (sql.includes('SELECT id, origin, permission, decision, updated_at')) {
      return this.state.permissions.get(`${String(args[0])}|${String(args[1])}|${String(args[2])}`)
    }

    return undefined
  }

  private all(sql: string, args: unknown[]): Row[] {
    if (sql.includes('FROM browser_history')) {
      const profileKey = String(args[0])
      const hasQuery = sql.includes('LIKE')
      const query = hasQuery ? stripLikePattern(args[1]).toLowerCase() : ''
      return [...this.state.history.values()]
        .filter(row => row.profile_key === profileKey)
        .filter(
          row =>
            !hasQuery ||
            [row.url, row.title].some(value =>
              String(value ?? '')
                .toLowerCase()
                .includes(query),
            ),
        )
        .sort(byLastVisitedDesc)
        .slice(0, Number(args[hasQuery ? 3 : 1]))
    }

    if (sql.includes('FROM browser_bookmarks')) {
      const profileKey = String(args[0])
      const hasQuery = sql.includes('LIKE')
      const query = hasQuery ? stripLikePattern(args[1]).toLowerCase() : ''
      return [...this.state.bookmarks.values()]
        .filter(row => row.profile_key === profileKey)
        .filter(
          row =>
            !hasQuery ||
            [row.url, row.title].some(value =>
              String(value ?? '')
                .toLowerCase()
                .includes(query),
            ),
        )
        .sort(
          (left, right) =>
            Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0) ||
            byUpdatedDesc(left, right),
        )
        .slice(0, Number(args[hasQuery ? 3 : 1]))
    }

    if (sql.includes('FROM browser_downloads')) {
      return [...this.state.downloads.values()]
        .filter(row => row.profile_key === String(args[0]))
        .sort((left, right) =>
          String(right.started_at ?? '').localeCompare(String(left.started_at ?? '')),
        )
        .slice(0, Number(args[1]))
    }

    return []
  }

  private run(sql: string, args: unknown[]): void {
    if (sql.includes('INSERT INTO browser_profile_settings')) {
      this.state.settings.set(String(args[0]), { homepage_url: args[1] })
      return
    }

    if (sql.includes('INSERT INTO browser_history')) {
      const key = `${String(args[1])}|${String(args[2])}`
      const current = this.state.history.get(key)
      this.state.history.set(key, {
        id: current?.id ?? args[0],
        profile_key: args[1],
        url: args[2],
        title: args[3] ?? current?.title ?? null,
        favicon_url: args[4] ?? current?.favicon_url ?? null,
        visit_count: Number(current?.visit_count ?? 0) + 1,
        last_visited_at: args[5],
      })
      return
    }

    if (sql.includes('DELETE FROM browser_history')) {
      this.deleteScopedRows(this.state.history, String(args[0]), args[1])
      return
    }

    if (sql.includes('INSERT INTO browser_bookmarks')) {
      const key = `${String(args[1])}|${String(args[2])}`
      const current = this.state.bookmarks.get(key)
      this.state.bookmarks.set(key, {
        id: current?.id ?? args[0],
        profile_key: args[1],
        url: args[2],
        title: args[3],
        favicon_url: args[4] ?? current?.favicon_url ?? null,
        folder_id: null,
        sort_order: 0,
        created_at: current?.created_at ?? args[5],
        updated_at: args[6],
      })
      return
    }

    if (sql.includes('DELETE FROM browser_bookmarks')) {
      this.deleteScopedRows(this.state.bookmarks, String(args[0]), undefined, String(args[1]))
      return
    }

    if (sql.includes('INSERT INTO browser_downloads')) {
      this.state.downloads.set(String(args[0]), {
        id: args[0],
        profile_key: args[1],
        url: args[2],
        filename: args[3],
        save_path: args[4],
        state: 'progressing',
        received_bytes: 0,
        total_bytes: null,
        started_at: args[5],
        ended_at: null,
        error: null,
      })
      return
    }

    if (sql.includes('UPDATE browser_downloads')) {
      this.state.downloads.set(String(args[6]), {
        ...this.state.downloads.get(String(args[6])),
        state: args[0],
        received_bytes: args[1],
        total_bytes: args[2],
        save_path: args[3],
        ended_at: args[4],
        error: args[5],
      })
      return
    }

    if (sql.includes('DELETE FROM browser_downloads')) {
      this.deleteScopedRows(this.state.downloads, String(args[0]))
      return
    }

    if (sql.includes('INSERT INTO browser_permission_decisions')) {
      const key = `${String(args[1])}|${String(args[2])}|${String(args[3])}`
      const current = this.state.permissions.get(key)
      this.state.permissions.set(key, {
        id: current?.id ?? args[0],
        profile_key: args[1],
        origin: args[2],
        permission: args[3],
        decision: args[4],
        updated_at: args[5],
      })
    }
  }

  private deleteScopedRows(
    rows: Map<string, Row>,
    profileKey: string,
    since?: unknown,
    id?: string,
  ): void {
    for (const [key, row] of rows) {
      if (row.profile_key !== profileKey) {
        continue
      }
      if (id && row.id !== id) {
        continue
      }
      if (since && String(row.last_visited_at ?? '') < String(since)) {
        continue
      }
      rows.delete(key)
    }
  }
}

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), 'opencove-browser-profile-'))
  tempDirs.push(dir)
  const { createBrowserProfileStore } =
    await import('../../../src/contexts/browser/infrastructure/main/BrowserProfileStore')
  return await createBrowserProfileStore({ dbPath: join(dir, 'opencove.db') })
}

afterEach(async () => {
  dbStateByPath.clear()
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

describe('BrowserProfileStore', () => {
  it('stores homepage per profile scope', async () => {
    const store = await createStore()
    expect(store.getHomepage(sharedScope)).toEqual({
      url: 'https://www.google.com/',
      isDefault: true,
    })

    store.setHomepage(sharedScope, 'https://opencove.local/start')
    store.setHomepage(profileScope, 'https://docs.example.test/')

    expect(store.getHomepage(sharedScope).url).toBe('https://opencove.local/start')
    expect(store.getHomepage(profileScope).url).toBe('https://docs.example.test/')
    store.dispose()
  })

  it('records history visits and excludes incognito passive history', async () => {
    const store = await createStore()
    store.recordHistoryVisit(sharedScope, {
      url: 'https://example.test/path',
      title: 'Example',
      atIso: '2026-05-01T10:00:00.000Z',
    })
    store.recordHistoryVisit(sharedScope, {
      url: 'https://example.test/path',
      title: 'Updated',
      faviconUrl: 'https://example.test/favicon.ico',
      atIso: '2026-05-01T10:02:00.000Z',
    })
    store.recordHistoryVisit(incognitoScope, {
      url: 'https://private.example.test/',
      title: 'Private',
    })

    const history = store.listHistory(sharedScope)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ title: 'Updated', visitCount: 2 })
    expect(store.listHistory(sharedScope, { query: 'private' })).toHaveLength(0)
    store.dispose()
  })

  it('upserts, finds and deletes bookmarks', async () => {
    const store = await createStore()
    const created = store.upsertBookmark({
      ...sharedScope,
      url: 'https://example.test/docs',
      title: 'Docs',
    })
    const updated = store.upsertBookmark({
      ...sharedScope,
      url: 'https://example.test/docs',
      title: 'Docs v2',
    })

    expect(updated.id).toBe(created.id)
    expect(updated.title).toBe('Docs v2')
    expect(store.findBookmarkByUrl(sharedScope, 'https://example.test/docs')?.id).toBe(created.id)
    expect(store.listBookmarks(sharedScope, { query: 'v2' })).toHaveLength(1)

    store.deleteBookmark(sharedScope, created.id)
    expect(store.findBookmarkByUrl(sharedScope, 'https://example.test/docs')).toBeNull()
    store.dispose()
  })

  it('tracks downloads and skips incognito passive downloads', async () => {
    const store = await createStore()
    expect(
      store.createDownload(sharedScope, {
        id: 'download-1',
        url: 'https://example.test/file.zip',
        filename: 'file.zip',
        savePath: '/tmp/file.zip',
      }),
    ).toMatchObject({ id: 'download-1', state: 'progressing' })
    store.updateDownload('download-1', {
      state: 'completed',
      receivedBytes: 10,
      totalBytes: 10,
      endedAt: '2026-05-01T11:00:00.000Z',
    })

    expect(store.getDownloadById('download-1')).toMatchObject({
      state: 'completed',
      receivedBytes: 10,
      totalBytes: 10,
    })
    expect(
      store.createDownload(incognitoScope, {
        id: 'download-private',
        url: 'https://private.example.test/file.zip',
        filename: 'private.zip',
      }),
    ).toBeNull()
    expect(store.getDownloadById('download-private')).toBeNull()

    store.clearDownloads(sharedScope)
    expect(store.listDownloads(sharedScope)).toHaveLength(0)
    store.dispose()
  })

  it('stores permission decisions outside incognito', async () => {
    const store = await createStore()
    expect(store.getPermissionDecision(sharedScope, 'https://example.test', 'media')).toBeNull()

    store.setPermissionDecision(sharedScope, 'https://example.test', 'media', 'allow')
    expect(store.getPermissionDecision(sharedScope, 'https://example.test', 'media')).toBe('allow')
    store.setPermissionDecision(sharedScope, 'https://example.test', 'media', 'deny')
    expect(store.getPermissionDecision(sharedScope, 'https://example.test', 'media')).toBe('deny')
    expect(
      store.setPermissionDecision(incognitoScope, 'https://private.example.test', 'media', 'allow'),
    ).toBeNull()
    expect(
      store.getPermissionDecision(incognitoScope, 'https://private.example.test', 'media'),
    ).toBeNull()
    store.dispose()
  })
})
