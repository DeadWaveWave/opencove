import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import type {
  BrowserBookmark,
  BrowserDownloadIdInput,
  BrowserDownloadRecord,
  BrowserHistoryEntry,
  BrowserHomepageResult,
  ClearBrowserHistoryInput,
  DeleteBrowserBookmarkInput,
  DeleteBrowserHistoryInput,
  FindBrowserBookmarkInput,
  GetBrowserHomepageInput,
  ListBrowserBookmarksInput,
  ListBrowserDownloadsInput,
  ListBrowserHistoryInput,
  RespondBrowserPermissionInput,
  SetBrowserHomepageInput,
  UpsertBrowserBookmarkInput,
} from '../../shared/contracts/dto'
import { invokeIpc } from './ipcInvoke'

export function createBrowserProfilePreloadApi(): {
  getHomepage: (payload: GetBrowserHomepageInput) => Promise<BrowserHomepageResult>
  setHomepage: (payload: SetBrowserHomepageInput) => Promise<void>
  listHistory: (payload: ListBrowserHistoryInput) => Promise<BrowserHistoryEntry[]>
  deleteHistory: (payload: DeleteBrowserHistoryInput) => Promise<void>
  clearHistory: (payload: ClearBrowserHistoryInput) => Promise<void>
  listBookmarks: (payload: ListBrowserBookmarksInput) => Promise<BrowserBookmark[]>
  findBookmark: (payload: FindBrowserBookmarkInput) => Promise<BrowserBookmark | null>
  upsertBookmark: (payload: UpsertBrowserBookmarkInput) => Promise<BrowserBookmark>
  deleteBookmark: (payload: DeleteBrowserBookmarkInput) => Promise<void>
  listDownloads: (payload: ListBrowserDownloadsInput) => Promise<BrowserDownloadRecord[]>
  clearDownloads: (payload: ListBrowserDownloadsInput) => Promise<void>
  cancelDownload: (payload: BrowserDownloadIdInput) => Promise<void>
  showDownload: (payload: BrowserDownloadIdInput) => Promise<void>
  respondPermission: (payload: RespondBrowserPermissionInput) => Promise<void>
} {
  return {
    getHomepage: payload => invokeIpc(IPC_CHANNELS.browserProfileGetHomepage, payload),
    setHomepage: payload => invokeIpc(IPC_CHANNELS.browserProfileSetHomepage, payload),
    listHistory: payload => invokeIpc(IPC_CHANNELS.browserProfileListHistory, payload),
    deleteHistory: payload => invokeIpc(IPC_CHANNELS.browserProfileDeleteHistory, payload),
    clearHistory: payload => invokeIpc(IPC_CHANNELS.browserProfileClearHistory, payload),
    listBookmarks: payload => invokeIpc(IPC_CHANNELS.browserProfileListBookmarks, payload),
    findBookmark: payload => invokeIpc(IPC_CHANNELS.browserProfileFindBookmark, payload),
    upsertBookmark: payload => invokeIpc(IPC_CHANNELS.browserProfileUpsertBookmark, payload),
    deleteBookmark: payload => invokeIpc(IPC_CHANNELS.browserProfileDeleteBookmark, payload),
    listDownloads: payload => invokeIpc(IPC_CHANNELS.browserProfileListDownloads, payload),
    clearDownloads: payload => invokeIpc(IPC_CHANNELS.browserProfileClearDownloads, payload),
    cancelDownload: payload => invokeIpc(IPC_CHANNELS.browserProfileCancelDownload, payload),
    showDownload: payload => invokeIpc(IPC_CHANNELS.browserProfileShowDownload, payload),
    respondPermission: payload => invokeIpc(IPC_CHANNELS.browserProfileRespondPermission, payload),
  }
}
