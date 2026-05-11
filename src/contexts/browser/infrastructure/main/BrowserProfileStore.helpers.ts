import type {
  BrowserBookmark,
  BrowserDownloadRecord,
  BrowserDownloadState,
  BrowserHistoryEntry,
} from '../../../../shared/contracts/dto'
import { resolveWebsiteNavigationUrl } from '../../../../shared/utils/websiteUrl'

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

export function normalizeLimit(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_LIST_LIMIT
  }

  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(value)))
}

export function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

export function normalizeUrl(value: string): string | null {
  return resolveWebsiteNavigationUrl(value).url
}

export function likePattern(query: string): string {
  return `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
}

export function toHistoryEntry(row: Record<string, unknown>): BrowserHistoryEntry {
  return {
    id: String(row.id ?? ''),
    url: String(row.url ?? ''),
    title: typeof row.title === 'string' ? row.title : null,
    faviconUrl: typeof row.favicon_url === 'string' ? row.favicon_url : null,
    visitCount: normalizeNonNegativeInteger(row.visit_count),
    lastVisitedAt: String(row.last_visited_at ?? ''),
  }
}

export function toBookmark(row: Record<string, unknown>): BrowserBookmark {
  return {
    id: String(row.id ?? ''),
    url: String(row.url ?? ''),
    title: String(row.title ?? ''),
    faviconUrl: typeof row.favicon_url === 'string' ? row.favicon_url : null,
    folderId: typeof row.folder_id === 'string' ? row.folder_id : null,
    sortOrder: normalizeNonNegativeInteger(row.sort_order),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

export function toDownload(row: Record<string, unknown>): BrowserDownloadRecord {
  return {
    id: String(row.id ?? ''),
    url: String(row.url ?? ''),
    filename: String(row.filename ?? ''),
    savePath: typeof row.save_path === 'string' ? row.save_path : null,
    state: String(row.state ?? 'interrupted') as BrowserDownloadState,
    receivedBytes: normalizeNonNegativeInteger(row.received_bytes),
    totalBytes:
      typeof row.total_bytes === 'number' ? normalizeNonNegativeInteger(row.total_bytes) : null,
    startedAt: String(row.started_at ?? ''),
    endedAt: typeof row.ended_at === 'string' ? row.ended_at : null,
    error: typeof row.error === 'string' ? row.error : null,
  }
}
