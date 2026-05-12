import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Bookmark, Clock, Download, Home, Star } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  BrowserBookmark,
  BrowserDownloadRecord,
  BrowserHistoryEntry,
  BrowserMode,
  BrowserProfileScopeInput,
  WebsiteWindowDownloadEvent,
  WebsiteWindowFindResultEvent,
  WebsiteWindowPermissionRequestEvent,
  WebsiteWindowSessionMode,
} from '@shared/contracts/dto'
import {
  WebsiteNodeBrowserPanel,
  type WebsiteNodeBrowserPanelKind,
} from './WebsiteNode.browserPanel'
import { mergeBrowserDownloadRecords } from './WebsiteNode.browserDownloads'

type BrowserPanel = WebsiteNodeBrowserPanelKind | null

export interface WebsiteNodeBrowserToolsProps {
  nodeId: string
  url: string
  currentUrl: string
  title: string
  faviconUrl: string | null
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
  browserMode: BrowserMode
  nativeApiAvailable: boolean
  findResult: WebsiteWindowFindResultEvent | null
  findRequestId: number
  downloads: WebsiteWindowDownloadEvent[]
  permissionRequests: WebsiteWindowPermissionRequestEvent[]
  onNavigate: (url: string) => void
  onInteractionStart?: () => void
}

function resolveScope(
  sessionMode: WebsiteWindowSessionMode,
  profileId: string | null,
): BrowserProfileScopeInput {
  return {
    sessionMode,
    profileId: sessionMode === 'profile' ? profileId : null,
  }
}

function resolveDisplayUrl(currentUrl: string, url: string): string {
  const runtimeUrl = currentUrl.trim()
  if (runtimeUrl.length > 0) {
    return runtimeUrl
  }

  return url.trim()
}

export function WebsiteNodeBrowserTools({
  nodeId,
  url,
  currentUrl,
  title,
  faviconUrl,
  sessionMode,
  profileId,
  browserMode,
  nativeApiAvailable,
  findResult,
  findRequestId,
  downloads,
  permissionRequests,
  onNavigate,
  onInteractionStart,
}: WebsiteNodeBrowserToolsProps): JSX.Element {
  const { t } = useTranslation()
  const browserApi = window.opencoveApi?.browserProfile ?? null
  const websiteApi = window.opencoveApi?.websiteWindow ?? null
  const scope = useMemo(() => resolveScope(sessionMode, profileId), [profileId, sessionMode])
  const displayUrl = resolveDisplayUrl(currentUrl, url)
  const [activePanel, setActivePanel] = useState<BrowserPanel>(null)
  const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>([])
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([])
  const [downloadRecords, setDownloadRecords] = useState<BrowserDownloadRecord[]>([])
  const [activeBookmark, setActiveBookmark] = useState<BrowserBookmark | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const [rememberPermission, setRememberPermission] = useState(true)
  const [dismissedPermissionIds, setDismissedPermissionIds] = useState<Set<string>>(() => new Set())

  const loadPanel = useCallback(
    async (panel: BrowserPanel) => {
      if (!browserApi || !panel) {
        return
      }

      if (panel === 'bookmarks') {
        setBookmarks(await browserApi.listBookmarks({ ...scope, limit: 30 }))
        return
      }

      if (panel === 'history') {
        setHistory(await browserApi.listHistory({ ...scope, limit: 30 }))
        return
      }

      setDownloadRecords(await browserApi.listDownloads({ ...scope, limit: 30 }))
    },
    [browserApi, scope],
  )

  useEffect(() => {
    if (!activePanel) {
      return
    }

    void loadPanel(activePanel).catch(() => undefined)
  }, [activePanel, downloads, loadPanel])

  useEffect(() => {
    let cancelled = false
    if (!browserApi || displayUrl.length === 0) {
      setActiveBookmark(null)
      return
    }

    void browserApi
      .findBookmark({ ...scope, url: displayUrl })
      .then(bookmark => {
        if (!cancelled) {
          setActiveBookmark(bookmark)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveBookmark(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [browserApi, displayUrl, scope])

  const navigateHome = useCallback(() => {
    onNavigate('')
  }, [onNavigate])

  const toggleBookmark = useCallback(() => {
    if (!browserApi || displayUrl.length === 0) {
      return
    }

    if (activeBookmark) {
      void browserApi
        .deleteBookmark({ ...scope, id: activeBookmark.id })
        .then(() => {
          setActiveBookmark(null)
          if (activePanel === 'bookmarks') {
            return loadPanel('bookmarks')
          }
          return undefined
        })
        .catch(() => undefined)
      return
    }

    void browserApi
      .upsertBookmark({
        ...scope,
        url: displayUrl,
        title: title.trim().length > 0 ? title : displayUrl,
        faviconUrl,
      })
      .then(bookmark => {
        setActiveBookmark(bookmark)
        if (activePanel === 'bookmarks') {
          return loadPanel('bookmarks')
        }
        return undefined
      })
      .catch(() => undefined)
  }, [activeBookmark, activePanel, browserApi, displayUrl, faviconUrl, loadPanel, scope, title])

  const openPanel = useCallback(
    (panel: WebsiteNodeBrowserPanelKind) => {
      const nextPanel = activePanel === panel ? null : panel
      setActivePanel(nextPanel)
      if (nextPanel) {
        void loadPanel(nextPanel).catch(() => undefined)
      }
    },
    [activePanel, loadPanel],
  )

  const submitFind = useCallback(() => {
    const query = findQuery.trim()
    if (!nativeApiAvailable || browserMode !== 'native' || query.length === 0) {
      return
    }

    void websiteApi?.findInPage?.({ nodeId, query, findNext: true }).catch(() => undefined)
  }, [browserMode, findQuery, nativeApiAvailable, nodeId, websiteApi])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setFindQuery('')
    void websiteApi?.stopFindInPage?.({ nodeId }).catch(() => undefined)
  }, [nodeId, websiteApi])

  useEffect(() => {
    if (findRequestId <= 0 || !nativeApiAvailable || browserMode !== 'native') {
      return
    }

    setFindOpen(true)
  }, [browserMode, findRequestId, nativeApiAvailable])

  useEffect(() => {
    if (!findOpen) {
      return
    }

    findInputRef.current?.focus()
    findInputRef.current?.select()
  }, [findOpen])

  const respondPermission = useCallback(
    (requestId: string, decision: 'allow' | 'deny') => {
      if (!browserApi) {
        return
      }

      setDismissedPermissionIds(previous => new Set(previous).add(requestId))
      void browserApi
        .respondPermission({ requestId, decision, remember: rememberPermission })
        .catch(() => undefined)
    },
    [browserApi, rememberPermission],
  )

  const pendingPermission =
    permissionRequests.find(item => !dismissedPermissionIds.has(item.requestId)) ?? null
  const visibleDownloads = useMemo(
    () => mergeBrowserDownloadRecords(downloadRecords, downloads),
    [downloadRecords, downloads],
  )

  return (
    <>
      <div className="website-node__browser-tools nodrag">
        <button
          type="button"
          className="website-node__tool-button"
          onClick={event => {
            event.stopPropagation()
            navigateHome()
          }}
          aria-label={t('websiteNode.home')}
          title={t('websiteNode.home')}
        >
          <Home aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`website-node__tool-button ${activeBookmark ? 'website-node__tool-button--active' : ''}`}
          onClick={event => {
            event.stopPropagation()
            toggleBookmark()
          }}
          disabled={!browserApi || displayUrl.length === 0}
          aria-label={
            activeBookmark ? t('websiteNode.removeBookmark') : t('websiteNode.addBookmark')
          }
          title={activeBookmark ? t('websiteNode.removeBookmark') : t('websiteNode.addBookmark')}
        >
          <Star aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`website-node__tool-button ${activePanel === 'bookmarks' ? 'website-node__tool-button--active' : ''}`}
          onClick={event => {
            event.stopPropagation()
            openPanel('bookmarks')
          }}
          disabled={!browserApi}
          aria-label={t('websiteNode.bookmarks')}
          title={t('websiteNode.bookmarks')}
        >
          <Bookmark aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`website-node__tool-button ${activePanel === 'history' ? 'website-node__tool-button--active' : ''}`}
          onClick={event => {
            event.stopPropagation()
            openPanel('history')
          }}
          disabled={!browserApi}
          aria-label={t('websiteNode.history')}
          title={t('websiteNode.history')}
        >
          <Clock aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`website-node__tool-button ${activePanel === 'downloads' ? 'website-node__tool-button--active' : ''}`}
          onClick={event => {
            event.stopPropagation()
            openPanel('downloads')
          }}
          disabled={!browserApi}
          aria-label={t('websiteNode.downloads')}
          title={t('websiteNode.downloads')}
        >
          <Download aria-hidden="true" />
        </button>

        {findOpen ? (
          <form
            className="website-node__find"
            onSubmit={event => {
              event.preventDefault()
              event.stopPropagation()
              submitFind()
            }}
          >
            <input
              ref={findInputRef}
              className="website-node__find-input"
              value={findQuery}
              placeholder={t('websiteNode.findPlaceholder')}
              aria-label={t('websiteNode.findPlaceholder')}
              onChange={event => {
                setFindQuery(event.target.value)
              }}
              onFocus={() => {
                onInteractionStart?.()
              }}
            />
            <span className="website-node__find-count">
              {findResult ? `${findResult.activeMatchOrdinal}/${findResult.matches}` : '-'}
            </span>
            <button type="submit" className="website-node__panel-action">
              {t('websiteNode.findNext')}
            </button>
            <button type="button" className="website-node__panel-action" onClick={closeFind}>
              {t('websiteNode.close')}
            </button>
          </form>
        ) : null}
      </div>

      {activePanel ? (
        <WebsiteNodeBrowserPanel
          panel={activePanel}
          bookmarks={bookmarks}
          history={history}
          downloads={visibleDownloads}
          onNavigate={onNavigate}
          onDeleteBookmark={id => {
            if (!browserApi) {
              return
            }
            void browserApi
              .deleteBookmark({ ...scope, id })
              .then(() => loadPanel('bookmarks'))
              .catch(() => undefined)
          }}
          onDeleteHistory={id => {
            if (!browserApi) {
              return
            }
            void browserApi
              .deleteHistory({ ...scope, id })
              .then(() => loadPanel('history'))
              .catch(() => undefined)
          }}
          onCancelDownload={id => {
            void browserApi?.cancelDownload({ id }).catch(() => undefined)
          }}
          onShowDownload={id => {
            void browserApi?.showDownload({ id }).catch(() => undefined)
          }}
          onClose={() => setActivePanel(null)}
        />
      ) : null}

      {pendingPermission ? (
        <div className="website-node__permission nodrag" role="dialog" aria-modal="false">
          <div className="website-node__permission-title">{t('websiteNode.permissionRequest')}</div>
          <div className="website-node__permission-detail">
            {pendingPermission.origin} · {pendingPermission.permission}
          </div>
          <label className="website-node__permission-remember">
            <input
              type="checkbox"
              checked={rememberPermission}
              onChange={event => {
                setRememberPermission(event.target.checked)
              }}
            />
            {t('websiteNode.rememberPermission')}
          </label>
          <div className="website-node__permission-actions">
            <button
              type="button"
              className="website-node__panel-action"
              onClick={() => respondPermission(pendingPermission.requestId, 'deny')}
            >
              {t('websiteNode.denyPermission')}
            </button>
            <button
              type="button"
              className="website-node__panel-action website-node__panel-action--primary"
              onClick={() => respondPermission(pendingPermission.requestId, 'allow')}
            >
              {t('websiteNode.allowPermission')}
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
