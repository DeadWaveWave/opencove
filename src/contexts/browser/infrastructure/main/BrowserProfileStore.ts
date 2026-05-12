import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import type {
  BrowserBookmark,
  BrowserDownloadRecord,
  BrowserDownloadState,
  BrowserHistoryEntry,
  BrowserHomepageResult,
  BrowserPermissionDecision,
  BrowserPermissionDecisionRecord,
  BrowserProfileScopeInput,
  UpsertBrowserBookmarkInput,
} from '../../../../shared/contracts/dto'
import { migrate } from '../../../../platform/persistence/sqlite/migrate'
import {
  DEFAULT_BROWSER_HOME_URL,
  resolveBrowserProfileKey,
  shouldPersistPassiveBrowserData,
} from '../../domain/browserProfileScope'
import {
  likePattern,
  normalizeLimit,
  normalizeText,
  normalizeUrl,
  toBookmark,
  toDownload,
  toHistoryEntry,
} from './BrowserProfileStore.helpers'

export interface BrowserProfileStore {
  getHomepage: (scope: BrowserProfileScopeInput) => BrowserHomepageResult
  setHomepage: (scope: BrowserProfileScopeInput, url: string) => void
  recordHistoryVisit: (
    scope: BrowserProfileScopeInput,
    visit: { url: string; title?: string | null; faviconUrl?: string | null; atIso?: string },
  ) => void
  listHistory: (
    scope: BrowserProfileScopeInput,
    options?: { query?: string | null; limit?: number | null },
  ) => BrowserHistoryEntry[]
  deleteHistoryEntry: (scope: BrowserProfileScopeInput, id: string) => void
  clearHistory: (scope: BrowserProfileScopeInput, sinceIso?: string | null) => void
  listBookmarks: (
    scope: BrowserProfileScopeInput,
    options?: { query?: string | null; limit?: number | null },
  ) => BrowserBookmark[]
  findBookmarkByUrl: (scope: BrowserProfileScopeInput, url: string) => BrowserBookmark | null
  upsertBookmark: (input: UpsertBrowserBookmarkInput) => BrowserBookmark
  deleteBookmark: (scope: BrowserProfileScopeInput, id: string) => void
  createDownload: (
    scope: BrowserProfileScopeInput,
    record: { id?: string; url: string; filename: string; savePath?: string | null },
  ) => BrowserDownloadRecord | null
  updateDownload: (
    id: string,
    patch: {
      state?: BrowserDownloadState
      receivedBytes?: number
      totalBytes?: number | null
      savePath?: string | null
      endedAt?: string | null
      error?: string | null
    },
  ) => void
  listDownloads: (
    scope: BrowserProfileScopeInput,
    options?: { limit?: number | null },
  ) => BrowserDownloadRecord[]
  getDownloadById: (id: string) => BrowserDownloadRecord | null
  clearDownloads: (scope: BrowserProfileScopeInput) => void
  getPermissionDecision: (
    scope: BrowserProfileScopeInput,
    origin: string,
    permission: string,
  ) => BrowserPermissionDecision | null
  setPermissionDecision: (
    scope: BrowserProfileScopeInput,
    origin: string,
    permission: string,
    decision: BrowserPermissionDecision,
  ) => BrowserPermissionDecisionRecord | null
  dispose: () => void
}

export async function createBrowserProfileStore(storeOptions: {
  dbPath: string
}): Promise<BrowserProfileStore> {
  await mkdir(dirname(storeOptions.dbPath), { recursive: true })
  const db = new Database(storeOptions.dbPath)
  migrate(db)

  const getHomepage = (scope: BrowserProfileScopeInput): BrowserHomepageResult => {
    const profileKey = resolveBrowserProfileKey(scope)
    const row = db
      .prepare('SELECT homepage_url FROM browser_profile_settings WHERE profile_key = ? LIMIT 1')
      .get(profileKey) as { homepage_url?: unknown } | undefined
    const url = typeof row?.homepage_url === 'string' ? normalizeText(row.homepage_url) : null
    return url ? { url, isDefault: false } : { url: DEFAULT_BROWSER_HOME_URL, isDefault: true }
  }

  const setHomepage = (scope: BrowserProfileScopeInput, url: string): void => {
    const profileKey = resolveBrowserProfileKey(scope)
    const normalizedUrl = normalizeUrl(url) ?? DEFAULT_BROWSER_HOME_URL
    db.prepare(
      `
        INSERT INTO browser_profile_settings (profile_key, homepage_url, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_key) DO UPDATE SET
          homepage_url = excluded.homepage_url,
          updated_at = excluded.updated_at
      `,
    ).run(profileKey, normalizedUrl, new Date().toISOString())
  }

  const recordHistoryVisit: BrowserProfileStore['recordHistoryVisit'] = (scope, visit) => {
    if (!shouldPersistPassiveBrowserData(scope)) {
      return
    }

    const url = normalizeUrl(visit.url)
    if (!url) {
      return
    }

    const profileKey = resolveBrowserProfileKey(scope)
    const title = normalizeText(visit.title)
    const faviconUrl = normalizeText(visit.faviconUrl)
    const atIso = normalizeText(visit.atIso) ?? new Date().toISOString()
    db.prepare(
      `
        INSERT INTO browser_history (id, profile_key, url, title, favicon_url, visit_count, last_visited_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(profile_key, url) DO UPDATE SET
          title = COALESCE(excluded.title, browser_history.title),
          favicon_url = COALESCE(excluded.favicon_url, browser_history.favicon_url),
          visit_count = browser_history.visit_count + 1,
          last_visited_at = excluded.last_visited_at
      `,
    ).run(randomUUID(), profileKey, url, title, faviconUrl, atIso)
  }

  const listHistory: BrowserProfileStore['listHistory'] = (scope, options) => {
    const profileKey = resolveBrowserProfileKey(scope)
    const limit = normalizeLimit(options?.limit)
    const query = normalizeText(options?.query)
    const rows = query
      ? db
          .prepare(
            `
              SELECT id, url, title, favicon_url, visit_count, last_visited_at
              FROM browser_history
              WHERE profile_key = ?
                AND (url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')
              ORDER BY last_visited_at DESC
              LIMIT ?
            `,
          )
          .all(profileKey, likePattern(query), likePattern(query), limit)
      : db
          .prepare(
            `
              SELECT id, url, title, favicon_url, visit_count, last_visited_at
              FROM browser_history
              WHERE profile_key = ?
              ORDER BY last_visited_at DESC
              LIMIT ?
            `,
          )
          .all(profileKey, limit)
    return (rows as Record<string, unknown>[]).map(toHistoryEntry)
  }

  const deleteHistoryEntry: BrowserProfileStore['deleteHistoryEntry'] = (scope, id) => {
    db.prepare('DELETE FROM browser_history WHERE profile_key = ? AND id = ?').run(
      resolveBrowserProfileKey(scope),
      id.trim(),
    )
  }

  const clearHistory: BrowserProfileStore['clearHistory'] = (scope, sinceIso) => {
    const profileKey = resolveBrowserProfileKey(scope)
    const since = normalizeText(sinceIso)
    if (since) {
      db.prepare('DELETE FROM browser_history WHERE profile_key = ? AND last_visited_at >= ?').run(
        profileKey,
        since,
      )
      return
    }

    db.prepare('DELETE FROM browser_history WHERE profile_key = ?').run(profileKey)
  }

  const listBookmarks: BrowserProfileStore['listBookmarks'] = (scope, options) => {
    const profileKey = resolveBrowserProfileKey(scope)
    const limit = normalizeLimit(options?.limit)
    const query = normalizeText(options?.query)
    const rows = query
      ? db
          .prepare(
            `
              SELECT id, url, title, favicon_url, folder_id, sort_order, created_at, updated_at
              FROM browser_bookmarks
              WHERE profile_key = ?
                AND (url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')
              ORDER BY sort_order ASC, updated_at DESC
              LIMIT ?
            `,
          )
          .all(profileKey, likePattern(query), likePattern(query), limit)
      : db
          .prepare(
            `
              SELECT id, url, title, favicon_url, folder_id, sort_order, created_at, updated_at
              FROM browser_bookmarks
              WHERE profile_key = ?
              ORDER BY sort_order ASC, updated_at DESC
              LIMIT ?
            `,
          )
          .all(profileKey, limit)
    return (rows as Record<string, unknown>[]).map(toBookmark)
  }

  const findBookmarkByUrl: BrowserProfileStore['findBookmarkByUrl'] = (scope, url) => {
    const normalizedUrl = normalizeUrl(url)
    if (!normalizedUrl) {
      return null
    }

    const row = db
      .prepare(
        `
          SELECT id, url, title, favicon_url, folder_id, sort_order, created_at, updated_at
          FROM browser_bookmarks
          WHERE profile_key = ? AND url = ?
          LIMIT 1
        `,
      )
      .get(resolveBrowserProfileKey(scope), normalizedUrl) as Record<string, unknown> | undefined
    return row ? toBookmark(row) : null
  }

  const upsertBookmark: BrowserProfileStore['upsertBookmark'] = input => {
    const profileKey = resolveBrowserProfileKey(input)
    const url = normalizeUrl(input.url)
    if (!url) {
      throw new Error('Invalid bookmark URL')
    }

    const now = new Date().toISOString()
    const title = normalizeText(input.title) ?? url
    const faviconUrl = normalizeText(input.faviconUrl)
    db.prepare(
      `
        INSERT INTO browser_bookmarks (
          id, profile_key, url, title, favicon_url, folder_id, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)
        ON CONFLICT(profile_key, url) DO UPDATE SET
          title = excluded.title,
          favicon_url = COALESCE(excluded.favicon_url, browser_bookmarks.favicon_url),
          updated_at = excluded.updated_at
      `,
    ).run(randomUUID(), profileKey, url, title, faviconUrl, now, now)

    const bookmark = findBookmarkByUrl(input, url)
    if (!bookmark) {
      throw new Error('Failed to save bookmark')
    }

    return bookmark
  }

  const deleteBookmark: BrowserProfileStore['deleteBookmark'] = (scope, id) => {
    db.prepare('DELETE FROM browser_bookmarks WHERE profile_key = ? AND id = ?').run(
      resolveBrowserProfileKey(scope),
      id.trim(),
    )
  }

  const createDownload: BrowserProfileStore['createDownload'] = (scope, record) => {
    if (!shouldPersistPassiveBrowserData(scope)) {
      return null
    }

    const url = normalizeUrl(record.url)
    const filename = normalizeText(record.filename)
    if (!url || !filename) {
      return null
    }

    const id = normalizeText(record.id) ?? randomUUID()
    const now = new Date().toISOString()
    db.prepare(
      `
        INSERT INTO browser_downloads (
          id, profile_key, url, filename, save_path, state, received_bytes,
          total_bytes, started_at, ended_at, error
        )
        VALUES (?, ?, ?, ?, ?, 'progressing', 0, NULL, ?, NULL, NULL)
      `,
    ).run(id, resolveBrowserProfileKey(scope), url, filename, normalizeText(record.savePath), now)
    const row = db.prepare('SELECT * FROM browser_downloads WHERE id = ? LIMIT 1').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? toDownload(row) : null
  }

  const updateDownload: BrowserProfileStore['updateDownload'] = (id, patch) => {
    const normalizedId = id.trim()
    if (normalizedId.length === 0) {
      return
    }

    const current = db
      .prepare('SELECT * FROM browser_downloads WHERE id = ? LIMIT 1')
      .get(normalizedId) as Record<string, unknown> | undefined
    if (!current) {
      return
    }

    db.prepare(
      `
        UPDATE browser_downloads
        SET state = ?, received_bytes = ?, total_bytes = ?, save_path = ?, ended_at = ?, error = ?
        WHERE id = ?
      `,
    ).run(
      patch.state ?? current.state,
      patch.receivedBytes ?? current.received_bytes ?? 0,
      patch.totalBytes === undefined ? current.total_bytes : patch.totalBytes,
      patch.savePath === undefined ? current.save_path : normalizeText(patch.savePath),
      patch.endedAt === undefined ? current.ended_at : patch.endedAt,
      patch.error === undefined ? current.error : patch.error,
      normalizedId,
    )
  }

  const listDownloads: BrowserProfileStore['listDownloads'] = (scope, options) => {
    const rows = db
      .prepare(
        `
          SELECT *
          FROM browser_downloads
          WHERE profile_key = ?
          ORDER BY started_at DESC
          LIMIT ?
        `,
      )
      .all(resolveBrowserProfileKey(scope), normalizeLimit(options?.limit))
    return (rows as Record<string, unknown>[]).map(toDownload)
  }

  const getDownloadById: BrowserProfileStore['getDownloadById'] = id => {
    const row = db
      .prepare('SELECT * FROM browser_downloads WHERE id = ? LIMIT 1')
      .get(id.trim()) as Record<string, unknown> | undefined
    return row ? toDownload(row) : null
  }

  const clearDownloads: BrowserProfileStore['clearDownloads'] = scope => {
    db.prepare('DELETE FROM browser_downloads WHERE profile_key = ?').run(
      resolveBrowserProfileKey(scope),
    )
  }

  const getPermissionDecision: BrowserProfileStore['getPermissionDecision'] = (
    scope,
    origin,
    permission,
  ) => {
    if (!shouldPersistPassiveBrowserData(scope)) {
      return null
    }

    const row = db
      .prepare(
        `
          SELECT decision
          FROM browser_permission_decisions
          WHERE profile_key = ? AND origin = ? AND permission = ?
          LIMIT 1
        `,
      )
      .get(resolveBrowserProfileKey(scope), origin, permission) as
      | { decision?: unknown }
      | undefined
    return row?.decision === 'allow' || row?.decision === 'deny' ? row.decision : null
  }

  const setPermissionDecision: BrowserProfileStore['setPermissionDecision'] = (
    scope,
    origin,
    permission,
    decision,
  ) => {
    if (!shouldPersistPassiveBrowserData(scope)) {
      return null
    }

    const id = randomUUID()
    const now = new Date().toISOString()
    db.prepare(
      `
        INSERT INTO browser_permission_decisions (
          id, profile_key, origin, permission, decision, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_key, origin, permission) DO UPDATE SET
          decision = excluded.decision,
          updated_at = excluded.updated_at
      `,
    ).run(id, resolveBrowserProfileKey(scope), origin, permission, decision, now)
    const row = db
      .prepare(
        `
          SELECT id, origin, permission, decision, updated_at
          FROM browser_permission_decisions
          WHERE profile_key = ? AND origin = ? AND permission = ?
          LIMIT 1
        `,
      )
      .get(resolveBrowserProfileKey(scope), origin, permission) as
      | Record<string, unknown>
      | undefined
    return row
      ? {
          id: String(row.id ?? ''),
          origin: String(row.origin ?? ''),
          permission: String(row.permission ?? ''),
          decision: row.decision === 'allow' ? 'allow' : 'deny',
          updatedAt: String(row.updated_at ?? ''),
        }
      : null
  }

  return {
    getHomepage,
    setHomepage,
    recordHistoryVisit,
    listHistory,
    deleteHistoryEntry,
    clearHistory,
    listBookmarks,
    findBookmarkByUrl,
    upsertBookmark,
    deleteBookmark,
    createDownload,
    updateDownload,
    listDownloads,
    getDownloadById,
    clearDownloads,
    getPermissionDecision,
    setPermissionDecision,
    dispose: () => {
      db.close()
    },
  }
}
