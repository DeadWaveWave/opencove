import type { WebsiteWindowSessionMode } from './websiteWindow'

export type BrowserMode = 'native' | 'iframe'

export type BrowserPermissionDecision = 'allow' | 'deny'

export type BrowserDownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

export interface BrowserProfileScopeInput {
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
}

export interface BrowserHistoryEntry {
  id: string
  url: string
  title: string | null
  faviconUrl: string | null
  visitCount: number
  lastVisitedAt: string
}

export interface BrowserBookmark {
  id: string
  url: string
  title: string
  faviconUrl: string | null
  folderId: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface BrowserDownloadRecord {
  id: string
  url: string
  filename: string
  savePath: string | null
  state: BrowserDownloadState
  receivedBytes: number
  totalBytes: number | null
  startedAt: string
  endedAt: string | null
  error: string | null
}

export interface BrowserPermissionDecisionRecord {
  id: string
  origin: string
  permission: string
  decision: BrowserPermissionDecision
  updatedAt: string
}

export interface BrowserHomepageResult {
  url: string
  isDefault: boolean
}

export interface ListBrowserHistoryInput extends BrowserProfileScopeInput {
  query?: string | null
  limit?: number | null
}

export interface DeleteBrowserHistoryInput extends BrowserProfileScopeInput {
  id: string
}

export interface ClearBrowserHistoryInput extends BrowserProfileScopeInput {
  sinceIso?: string | null
}

export interface ListBrowserBookmarksInput extends BrowserProfileScopeInput {
  query?: string | null
  limit?: number | null
}

export interface UpsertBrowserBookmarkInput extends BrowserProfileScopeInput {
  url: string
  title?: string | null
  faviconUrl?: string | null
}

export interface DeleteBrowserBookmarkInput extends BrowserProfileScopeInput {
  id: string
}

export interface FindBrowserBookmarkInput extends BrowserProfileScopeInput {
  url: string
}

export interface GetBrowserHomepageInput extends BrowserProfileScopeInput {}

export interface SetBrowserHomepageInput extends BrowserProfileScopeInput {
  url: string
}

export interface ListBrowserDownloadsInput extends BrowserProfileScopeInput {
  limit?: number | null
}

export interface BrowserDownloadIdInput {
  id: string
}

export interface RespondBrowserPermissionInput {
  requestId: string
  decision: BrowserPermissionDecision
  remember: boolean
}
