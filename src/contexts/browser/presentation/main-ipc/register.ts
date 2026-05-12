import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { IpcChannel } from '../../../../shared/contracts/ipc'
import type {
  BrowserDownloadIdInput,
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
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { BrowserProfileStore } from '../../infrastructure/main/BrowserProfileStore'
import {
  cancelWebsiteWindowDownloadAcrossManagers,
  respondWebsiteWindowPermissionAcrossManagers,
} from '../../../../app/main/websiteWindow/websiteWindowManagerRegistry'

type StoreResolver = () => Promise<BrowserProfileStore>

function registerBrowserProfileHandler<TResult>(
  channel: IpcChannel,
  handler: (payload: unknown) => Promise<TResult> | TResult,
): void {
  registerHandledIpc<TResult, unknown>(channel, (_event, payload) => handler(payload), {
    defaultErrorCode: 'common.unexpected',
  })
}

function normalizeScope<T extends object>(payload: unknown): T & GetBrowserHomepageInput {
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const sessionMode =
    record.sessionMode === 'incognito' || record.sessionMode === 'profile'
      ? record.sessionMode
      : 'shared'
  const profileId = typeof record.profileId === 'string' ? record.profileId.trim() : ''
  return {
    ...(record as T),
    sessionMode,
    profileId: sessionMode === 'profile' && profileId.length > 0 ? profileId : null,
  } as T & GetBrowserHomepageInput
}

function normalizeIdPayload(payload: BrowserDownloadIdInput): BrowserDownloadIdInput {
  if (!payload || typeof payload.id !== 'string' || payload.id.trim().length === 0) {
    throw new Error('Invalid browser profile payload')
  }

  return { id: payload.id.trim() }
}

export function registerBrowserProfileIpcHandlers(
  getStore: StoreResolver,
): IpcRegistrationDisposable {
  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileGetHomepage, async payload => {
    const store = await getStore()
    return store.getHomepage(normalizeScope<GetBrowserHomepageInput>(payload))
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileSetHomepage, async payload => {
    const input = normalizeScope<SetBrowserHomepageInput>(payload)
    if (typeof input.url !== 'string') {
      throw new Error('Invalid homepage URL')
    }
    const store = await getStore()
    store.setHomepage(input, input.url)
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileListHistory, async payload => {
    const input = normalizeScope<ListBrowserHistoryInput>(payload)
    const store = await getStore()
    return store.listHistory(input, { query: input.query, limit: input.limit })
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileDeleteHistory, async payload => {
    const input = normalizeScope<DeleteBrowserHistoryInput>(payload)
    if (typeof input.id !== 'string') {
      throw new Error('Invalid history id')
    }
    const store = await getStore()
    store.deleteHistoryEntry(input, input.id)
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileClearHistory, async payload => {
    const input = normalizeScope<ClearBrowserHistoryInput>(payload)
    const store = await getStore()
    store.clearHistory(input, typeof input.sinceIso === 'string' ? input.sinceIso : null)
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileListBookmarks, async payload => {
    const input = normalizeScope<ListBrowserBookmarksInput>(payload)
    const store = await getStore()
    return store.listBookmarks(input, { query: input.query, limit: input.limit })
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileFindBookmark, async payload => {
    const input = normalizeScope<FindBrowserBookmarkInput>(payload)
    if (typeof input.url !== 'string') {
      return null
    }
    const store = await getStore()
    return store.findBookmarkByUrl(input, input.url)
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileUpsertBookmark, async payload => {
    const input = normalizeScope<UpsertBrowserBookmarkInput>(payload)
    if (typeof input.url !== 'string') {
      throw new Error('Invalid bookmark URL')
    }
    const store = await getStore()
    return store.upsertBookmark(input)
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileDeleteBookmark, async payload => {
    const input = normalizeScope<DeleteBrowserBookmarkInput>(payload)
    if (typeof input.id !== 'string') {
      throw new Error('Invalid bookmark id')
    }
    const store = await getStore()
    store.deleteBookmark(input, input.id)
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileListDownloads, async payload => {
    const input = normalizeScope<ListBrowserDownloadsInput>(payload)
    const store = await getStore()
    return store.listDownloads(input, { limit: input.limit })
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileClearDownloads, async payload => {
    const input = normalizeScope<ListBrowserDownloadsInput>(payload)
    const store = await getStore()
    store.clearDownloads(input)
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileCancelDownload, payload => {
    const input = normalizeIdPayload(payload as BrowserDownloadIdInput)
    cancelWebsiteWindowDownloadAcrossManagers(input.id)
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileShowDownload, async payload => {
    const input = normalizeIdPayload(payload as BrowserDownloadIdInput)
    const store = await getStore()
    const match = store.getDownloadById(input.id)
    if (match?.savePath) {
      shell.showItemInFolder(match.savePath)
    }
  })

  registerBrowserProfileHandler(IPC_CHANNELS.browserProfileRespondPermission, payload => {
    const input = payload as RespondBrowserPermissionInput
    if (
      !input ||
      typeof input.requestId !== 'string' ||
      (input.decision !== 'allow' && input.decision !== 'deny')
    ) {
      throw new Error('Invalid permission response')
    }
    respondWebsiteWindowPermissionAcrossManagers(input)
  })

  return {
    dispose: () => {
      for (const channel of [
        IPC_CHANNELS.browserProfileGetHomepage,
        IPC_CHANNELS.browserProfileSetHomepage,
        IPC_CHANNELS.browserProfileListHistory,
        IPC_CHANNELS.browserProfileDeleteHistory,
        IPC_CHANNELS.browserProfileClearHistory,
        IPC_CHANNELS.browserProfileListBookmarks,
        IPC_CHANNELS.browserProfileFindBookmark,
        IPC_CHANNELS.browserProfileUpsertBookmark,
        IPC_CHANNELS.browserProfileDeleteBookmark,
        IPC_CHANNELS.browserProfileListDownloads,
        IPC_CHANNELS.browserProfileClearDownloads,
        IPC_CHANNELS.browserProfileCancelDownload,
        IPC_CHANNELS.browserProfileShowDownload,
        IPC_CHANNELS.browserProfileRespondPermission,
      ]) {
        ipcMain.removeHandler(channel)
      }
    },
  }
}
