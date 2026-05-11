import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  BrowserBookmark,
  BrowserDownloadRecord,
  BrowserHistoryEntry,
} from '@shared/contracts/dto'

export type WebsiteNodeBrowserPanelKind = 'bookmarks' | 'history' | 'downloads'

function formatIsoDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

function formatBytes(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '-'
  }

  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} KB`
  }

  return `${Math.round(value / 1024 / 102.4) / 10} MB`
}

export function WebsiteNodeBrowserPanel({
  panel,
  bookmarks,
  history,
  downloads,
  onNavigate,
  onDeleteBookmark,
  onDeleteHistory,
  onCancelDownload,
  onShowDownload,
  onClose,
}: {
  panel: WebsiteNodeBrowserPanelKind
  bookmarks: BrowserBookmark[]
  history: BrowserHistoryEntry[]
  downloads: BrowserDownloadRecord[]
  onNavigate: (url: string) => void
  onDeleteBookmark: (id: string) => void
  onDeleteHistory: (id: string) => void
  onCancelDownload: (id: string) => void
  onShowDownload: (id: string) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const title =
    panel === 'bookmarks'
      ? t('websiteNode.bookmarks')
      : panel === 'history'
        ? t('websiteNode.history')
        : t('websiteNode.downloads')

  return (
    <div className="website-node__panel nodrag">
      <div className="website-node__panel-header">
        <span>{title}</span>
        <button type="button" className="website-node__panel-close" onClick={onClose}>
          {t('websiteNode.close')}
        </button>
      </div>
      <div className="website-node__panel-list">
        {panel === 'bookmarks'
          ? bookmarks.map(item => (
              <BrowserPanelRow
                key={item.id}
                title={item.title}
                detail={item.url}
                onOpen={() => onNavigate(item.url)}
                onDelete={() => onDeleteBookmark(item.id)}
              />
            ))
          : null}
        {panel === 'history'
          ? history.map(item => (
              <BrowserPanelRow
                key={item.id}
                title={item.title ?? item.url}
                detail={formatIsoDate(item.lastVisitedAt)}
                onOpen={() => onNavigate(item.url)}
                onDelete={() => onDeleteHistory(item.id)}
              />
            ))
          : null}
        {panel === 'downloads'
          ? downloads.map(item => (
              <BrowserDownloadRow
                key={item.id}
                item={item}
                onCancel={() => onCancelDownload(item.id)}
                onShow={() => onShowDownload(item.id)}
              />
            ))
          : null}
        {panel === 'bookmarks' && bookmarks.length === 0 ? (
          <div className="website-node__panel-empty">{t('websiteNode.emptyBookmarks')}</div>
        ) : null}
        {panel === 'history' && history.length === 0 ? (
          <div className="website-node__panel-empty">{t('websiteNode.emptyHistory')}</div>
        ) : null}
        {panel === 'downloads' && downloads.length === 0 ? (
          <div className="website-node__panel-empty">{t('websiteNode.emptyDownloads')}</div>
        ) : null}
      </div>
    </div>
  )
}

function BrowserPanelRow({
  title,
  detail,
  onOpen,
  onDelete,
}: {
  title: string
  detail: string
  onOpen: () => void
  onDelete: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="website-node__panel-row">
      <button type="button" className="website-node__panel-main" onClick={onOpen}>
        <span className="website-node__panel-title">{title}</span>
        <span className="website-node__panel-detail">{detail}</span>
      </button>
      <button type="button" className="website-node__panel-action" onClick={onDelete}>
        {t('websiteNode.delete')}
      </button>
    </div>
  )
}

function BrowserDownloadRow({
  item,
  onCancel,
  onShow,
}: {
  item: BrowserDownloadRecord
  onCancel: () => void
  onShow: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const canCancel = item.state === 'progressing'
  const detail = `${item.state} · ${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`
  return (
    <div className="website-node__panel-row">
      <div className="website-node__panel-main website-node__panel-main--static">
        <span className="website-node__panel-title">{item.filename}</span>
        <span className="website-node__panel-detail">{detail}</span>
      </div>
      {canCancel ? (
        <button type="button" className="website-node__panel-action" onClick={onCancel}>
          {t('websiteNode.cancelDownload')}
        </button>
      ) : null}
      <button
        type="button"
        className="website-node__panel-action"
        onClick={onShow}
        disabled={!item.savePath}
      >
        {t('websiteNode.showDownload')}
      </button>
    </div>
  )
}
