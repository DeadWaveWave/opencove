import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  ReleaseNotesItem,
  ReleaseNotesKind,
  ReleaseNotesRangeResult,
} from '@shared/contracts/dto'

const KIND_ORDER: ReleaseNotesKind[] = ['added', 'fixed', 'changed', 'docs', 'other']

function getKindTitleKey(kind: ReleaseNotesKind): string {
  switch (kind) {
    case 'added':
      return 'whatsNew.sections.added'
    case 'fixed':
      return 'whatsNew.sections.fixed'
    case 'changed':
      return 'whatsNew.sections.changed'
    case 'docs':
      return 'whatsNew.sections.docs'
    default:
      return 'whatsNew.sections.other'
  }
}

function groupItems(items: ReleaseNotesItem[]): Map<ReleaseNotesKind, ReleaseNotesItem[]> {
  const grouped = new Map<ReleaseNotesKind, ReleaseNotesItem[]>()
  for (const kind of KIND_ORDER) {
    grouped.set(kind, [])
  }

  for (const item of items) {
    const bucket = grouped.get(item.kind) ?? []
    bucket.push(item)
    grouped.set(item.kind, bucket)
  }

  return grouped
}

export function WhatsNewDialog({
  isOpen,
  fromVersion,
  toVersion,
  notes,
  isLoading,
  error,
  compareUrl,
  onClose,
}: {
  isOpen: boolean
  fromVersion: string | null
  toVersion: string | null
  notes: ReleaseNotesRangeResult | null
  isLoading: boolean
  error: string | null
  compareUrl: string | null
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!isOpen) {
    return null
  }

  const items = notes?.items ?? []
  const grouped = groupItems(items)
  const compareLinkLabel =
    compareUrl && compareUrl.includes('/compare/')
      ? t('whatsNew.viewCompare')
      : t('whatsNew.viewChangelog')

  return (
    <div
      className="cove-window-backdrop whats-new-backdrop"
      data-testid="whats-new-dialog"
      onClick={() => {
        onClose()
      }}
    >
      <section
        className="cove-window whats-new-window"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <header className="whats-new-header">
          <div>
            <h3>{t('whatsNew.title')}</h3>
            {fromVersion && toVersion ? (
              <p className="whats-new-subtitle">
                {t('whatsNew.subtitleRange', { fromVersion, toVersion })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            onClick={() => {
              onClose()
            }}
          >
            {t('common.close')}
          </button>
        </header>

        <div className="whats-new-body">
          {isLoading ? <p className="whats-new-muted">{t('whatsNew.loading')}</p> : null}
          {error ? <p className="whats-new-error">{error}</p> : null}

          {!isLoading && !error && items.length === 0 ? (
            <p className="whats-new-muted">{t('whatsNew.empty')}</p>
          ) : null}

          {!isLoading && items.length > 0 ? (
            <div className="whats-new-sections">
              {KIND_ORDER.map(kind => {
                const sectionItems = grouped.get(kind) ?? []
                if (sectionItems.length === 0) {
                  return null
                }

                return (
                  <section key={kind} className="whats-new-section">
                    <h4>{t(getKindTitleKey(kind))}</h4>
                    <ul className="whats-new-items">
                      {sectionItems.map(item => (
                        <li key={`${item.sha ?? ''}:${item.summary}`} className="whats-new-item">
                          {item.url ? (
                            <a href={item.url} target="_blank" rel="noreferrer">
                              {item.summary}
                            </a>
                          ) : (
                            item.summary
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          ) : null}
        </div>

        <footer className="whats-new-footer">
          {notes?.truncated ? (
            <span className="whats-new-muted">
              {t('whatsNew.truncated', { count: notes.items.length })}
            </span>
          ) : (
            <span />
          )}
          {compareUrl ? (
            <a
              className="whats-new-compare-link"
              href={compareUrl}
              target="_blank"
              rel="noreferrer"
            >
              {compareLinkLabel}
            </a>
          ) : null}
        </footer>
      </section>
    </div>
  )
}
