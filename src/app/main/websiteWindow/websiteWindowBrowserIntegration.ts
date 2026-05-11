import type { DownloadItem, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  BrowserDownloadState,
  BrowserProfileScopeInput,
  RespondBrowserPermissionInput,
  WebsiteWindowEventPayload,
} from '../../../shared/contracts/dto'
import type { BrowserProfileStore } from '../../../contexts/browser/infrastructure/main/BrowserProfileStore'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { resolveWebsiteWindowRuntimeWebContents } from './websiteWindowNavigationOps'

export type BrowserProfileStoreResolver = () => Promise<BrowserProfileStore>

interface PendingPermissionRequest {
  nodeId: string
  origin: string
  permission: string
  sessionMode: WebsiteWindowRuntime['sessionMode']
  profileId: string | null
  callback: (granted: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

export class WebsiteWindowBrowserIntegration {
  private downloadItemById = new Map<string, DownloadItem>()
  private pendingPermissionById = new Map<string, PendingPermissionRequest>()

  public constructor(
    private readonly options: {
      getBrowserProfileStore?: BrowserProfileStoreResolver
      getRuntimes: () => Iterable<WebsiteWindowRuntime>
      emit: (payload: WebsiteWindowEventPayload) => void
    },
  ) {}

  public dispose(): void {
    this.downloadItemById.clear()
    for (const pending of this.pendingPermissionById.values()) {
      clearTimeout(pending.timer)
      pending.callback(false)
    }
    this.pendingPermissionById.clear()
  }

  public cancelDownload(downloadId: string): void {
    const normalized = downloadId.trim()
    if (normalized.length === 0) {
      return
    }

    this.downloadItemById.get(normalized)?.cancel()
  }

  public respondPermissionRequest(response: RespondBrowserPermissionInput): void {
    const requestId = response.requestId.trim()
    const pending = this.pendingPermissionById.get(requestId)
    if (!pending) {
      return
    }

    this.pendingPermissionById.delete(requestId)
    clearTimeout(pending.timer)
    const granted = response.decision === 'allow'
    if (response.remember === true && this.options.getBrowserProfileStore) {
      void this.options
        .getBrowserProfileStore()
        .then(store => {
          store.setPermissionDecision(
            { sessionMode: pending.sessionMode, profileId: pending.profileId },
            pending.origin,
            pending.permission,
            granted ? 'allow' : 'deny',
          )
        })
        .catch(() => undefined)
    }
    pending.callback(granted)
  }

  public cancelPermissionRequestsForNode(nodeId: string): void {
    const normalizedNodeId = nodeId.trim()
    if (normalizedNodeId.length === 0) {
      return
    }

    for (const [requestId, pending] of this.pendingPermissionById) {
      if (pending.nodeId !== normalizedNodeId) {
        continue
      }

      this.pendingPermissionById.delete(requestId)
      clearTimeout(pending.timer)
      pending.callback(false)
    }
  }

  public recordHistoryVisit(runtime: WebsiteWindowRuntime): void {
    if (!this.options.getBrowserProfileStore || runtime.sessionMode === 'incognito') {
      return
    }

    const url = runtime.url?.trim() ?? ''
    if (url.length === 0) {
      return
    }

    void this.options
      .getBrowserProfileStore()
      .then(store => {
        store.recordHistoryVisit(
          { sessionMode: runtime.sessionMode, profileId: runtime.profileId },
          { url, title: runtime.title, faviconUrl: runtime.faviconUrl },
        )
      })
      .catch(() => undefined)
  }

  public handlePermissionCheck(
    _contents: WebContents | null,
    _permission: string,
    _origin: string,
  ): boolean {
    return false
  }

  public handlePermissionRequest(
    contents: WebContents,
    permission: string,
    origin: string,
    callback: (granted: boolean) => void,
  ): void {
    const runtime = this.findRuntimeByContents(contents)
    if (!runtime) {
      callback(false)
      return
    }

    const normalizedOrigin = normalizePermissionOrigin(origin || runtime.url || '')
    if (!normalizedOrigin || !this.options.getBrowserProfileStore) {
      callback(false)
      return
    }

    void this.options
      .getBrowserProfileStore()
      .then(store => {
        const decision = store.getPermissionDecision(
          { sessionMode: runtime.sessionMode, profileId: runtime.profileId },
          normalizedOrigin,
          permission,
        )
        if (decision) {
          callback(decision === 'allow')
          return
        }

        const requestId = randomUUID()
        const timer = setTimeout(() => {
          const pending = this.pendingPermissionById.get(requestId)
          if (!pending) {
            return
          }

          this.pendingPermissionById.delete(requestId)
          pending.callback(false)
        }, 30_000)
        this.pendingPermissionById.set(requestId, {
          nodeId: runtime.nodeId,
          origin: normalizedOrigin,
          permission,
          sessionMode: runtime.sessionMode,
          profileId: runtime.profileId,
          callback,
          timer,
        })
        this.options.emit({
          type: 'permission-request',
          nodeId: runtime.nodeId,
          requestId,
          origin: normalizedOrigin,
          permission,
        })
      })
      .catch(() => {
        callback(false)
      })
  }

  public handleDownload(contents: WebContents, item: DownloadItem): void {
    const runtime = this.findRuntimeByContents(contents)
    const downloadId = randomUUID()
    const url = item.getURL()
    const filename = item.getFilename()
    const scope: BrowserProfileScopeInput = {
      sessionMode: runtime?.sessionMode ?? 'shared',
      profileId: runtime?.profileId ?? null,
    }

    this.downloadItemById.set(downloadId, item)
    this.createDownloadRecord(scope, downloadId, item, url, filename)

    const publish = (state: BrowserDownloadState, error: string | null = null) => {
      const totalBytes = item.getTotalBytes()
      const payload = {
        type: 'download' as const,
        nodeId: runtime?.nodeId ?? null,
        downloadId,
        url,
        filename,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: totalBytes > 0 ? totalBytes : null,
        state,
        savePath: item.getSavePath() || null,
        error,
      }
      this.options.emit(payload)
      this.updateDownloadRecord(downloadId, payload, error)
    }

    item.on('updated', (_event, state) => {
      publish(state)
    })
    item.once('done', (_event, state) => {
      this.downloadItemById.delete(downloadId)
      publish(state)
    })
    publish('progressing')
  }

  private createDownloadRecord(
    scope: BrowserProfileScopeInput,
    id: string,
    item: DownloadItem,
    url: string,
    filename: string,
  ): void {
    if (!this.options.getBrowserProfileStore) {
      return
    }

    void this.options
      .getBrowserProfileStore()
      .then(store => {
        store.createDownload(scope, { id, url, filename, savePath: item.getSavePath() || null })
      })
      .catch(() => undefined)
  }

  private updateDownloadRecord(
    id: string,
    payload: Extract<WebsiteWindowEventPayload, { type: 'download' }>,
    error: string | null,
  ): void {
    if (!this.options.getBrowserProfileStore) {
      return
    }

    void this.options
      .getBrowserProfileStore()
      .then(store => {
        store.updateDownload(id, {
          state: payload.state,
          receivedBytes: payload.receivedBytes,
          totalBytes: payload.totalBytes,
          savePath: payload.savePath,
          endedAt: payload.state === 'progressing' ? null : new Date().toISOString(),
          error,
        })
      })
      .catch(() => undefined)
  }

  private findRuntimeByContents(contents: WebContents | null): WebsiteWindowRuntime | null {
    if (!contents) {
      return null
    }

    for (const runtime of this.options.getRuntimes()) {
      const candidate = resolveWebsiteWindowRuntimeWebContents(runtime)
      if (candidate === contents) {
        return runtime
      }
    }

    return null
  }
}

function normalizePermissionOrigin(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return value.trim()
  }
}
