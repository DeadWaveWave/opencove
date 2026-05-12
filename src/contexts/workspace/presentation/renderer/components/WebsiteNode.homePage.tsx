import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  resolveBrowserNavigationTarget,
  type BrowserSearchEngineId,
} from '@contexts/settings/domain/browserSettings'
import type {
  BrowserBookmark,
  BrowserHistoryEntry,
  BrowserProfileScopeInput,
  WebsiteWindowSessionMode,
} from '@shared/contracts/dto'

function resolveScope(
  sessionMode: WebsiteWindowSessionMode,
  profileId: string | null,
): BrowserProfileScopeInput {
  return {
    sessionMode,
    profileId: sessionMode === 'profile' ? profileId : null,
  }
}

export function WebsiteNodeHomePage({
  sessionMode,
  profileId,
  searchEngine,
  onNavigate,
  onInteractionStart,
}: {
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
  searchEngine: BrowserSearchEngineId
  onNavigate: (url: string) => void
  onInteractionStart?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const browserApi = window.opencoveApi?.browserProfile ?? null
  const scope = useMemo(() => resolveScope(sessionMode, profileId), [profileId, sessionMode])
  const [query, setQuery] = useState('')
  const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>([])
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([])

  useEffect(() => {
    let cancelled = false
    if (!browserApi) {
      setBookmarks([])
      setHistory([])
      return
    }

    void Promise.all([
      browserApi.listBookmarks({ ...scope, limit: 8 }),
      browserApi.listHistory({ ...scope, limit: 8 }),
    ])
      .then(([nextBookmarks, nextHistory]) => {
        if (!cancelled) {
          setBookmarks(nextBookmarks)
          setHistory(nextHistory)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBookmarks([])
          setHistory([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [browserApi, scope])

  const submitSearch = useCallback(() => {
    const target = resolveBrowserNavigationTarget(query, searchEngine)
    if (target === null) {
      return
    }

    onNavigate(target)
    setQuery('')
  }, [onNavigate, query, searchEngine])

  const visibleHistory = history.filter(
    item => !bookmarks.some(bookmark => bookmark.url === item.url),
  )

  return (
    <div className="website-node__home nodrag">
      <div className="website-node__home-inner">
        <div className="website-node__home-title">{t('websiteNode.startPageTitle')}</div>
        <form
          className="website-node__home-search"
          onSubmit={event => {
            event.preventDefault()
            event.stopPropagation()
            submitSearch()
          }}
        >
          <Search aria-hidden="true" />
          <input
            value={query}
            className="website-node__home-search-input"
            placeholder={t('websiteNode.startPageSearchPlaceholder')}
            aria-label={t('websiteNode.startPageSearchPlaceholder')}
            onChange={event => setQuery(event.target.value)}
            onFocus={onInteractionStart}
          />
        </form>

        {bookmarks.length > 0 ? (
          <StartPageSection title={t('websiteNode.startPageFavorites')}>
            {bookmarks.map(item => (
              <StartPageButton
                key={item.id}
                title={item.title}
                detail={item.url}
                onClick={() => onNavigate(item.url)}
              />
            ))}
          </StartPageSection>
        ) : null}

        {visibleHistory.length > 0 ? (
          <StartPageSection title={t('websiteNode.startPageRecent')}>
            {visibleHistory.slice(0, 8).map(item => (
              <StartPageButton
                key={item.id}
                title={item.title ?? item.url}
                detail={item.url}
                onClick={() => onNavigate(item.url)}
              />
            ))}
          </StartPageSection>
        ) : null}
      </div>
    </div>
  )
}

function StartPageSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="website-node__home-section">
      <h4>{title}</h4>
      <div className="website-node__home-grid">{children}</div>
    </section>
  )
}

function StartPageButton({
  title,
  detail,
  onClick,
}: {
  title: string
  detail: string
  onClick: () => void
}): JSX.Element {
  return (
    <button type="button" className="website-node__home-card" onClick={onClick}>
      <span className="website-node__home-card-title">{title}</span>
      <span className="website-node__home-card-detail">{detail}</span>
    </button>
  )
}
