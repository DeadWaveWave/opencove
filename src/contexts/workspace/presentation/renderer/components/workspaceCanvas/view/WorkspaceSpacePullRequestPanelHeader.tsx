import React from 'react'
import { Copy, ExternalLink, GitPullRequest, RefreshCw, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { GitHubPullRequestSummary } from '@shared/contracts/dto'

export function WorkspaceSpacePullRequestPanelHeader({
  summary,
  isLoading,
  onRefresh,
  onClose,
}: {
  summary: GitHubPullRequestSummary | null
  isLoading: boolean
  onRefresh: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const openExternalUrl = summary?.ref.url ?? null

  return (
    <div className="workspace-pr-panel__header">
      <div className="workspace-pr-panel__title">
        <GitPullRequest className="workspace-pr-panel__title-icon" aria-hidden="true" />
        <span className="workspace-pr-panel__title-text">
          {summary ? `#${summary.number}` : t('githubPullRequest.title')}
        </span>
      </div>

      <div className="workspace-pr-panel__header-actions">
        {openExternalUrl ? (
          <a
            className="workspace-pr-panel__header-icon"
            href={openExternalUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={t('githubPullRequest.openInBrowser')}
            data-testid="workspace-space-pr-panel-open-external"
          >
            <ExternalLink aria-hidden="true" />
          </a>
        ) : null}

        {openExternalUrl ? (
          <button
            type="button"
            className="workspace-pr-panel__header-icon"
            aria-label={t('githubPullRequest.copyLink')}
            data-testid="workspace-space-pr-panel-copy-link"
            onClick={() => {
              const writeText = window.opencoveApi?.clipboard?.writeText
              if (typeof writeText === 'function') {
                void writeText(openExternalUrl).catch(() => undefined)
                return
              }

              if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                void navigator.clipboard.writeText(openExternalUrl).catch(() => undefined)
              }
            }}
          >
            <Copy aria-hidden="true" />
          </button>
        ) : null}

        <button
          type="button"
          className="workspace-pr-panel__header-icon"
          aria-label={t('githubPullRequest.refresh')}
          data-testid="workspace-space-pr-panel-refresh"
          disabled={isLoading}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" />
        </button>

        <button
          type="button"
          className="workspace-pr-panel__header-icon"
          aria-label={t('common.close')}
          data-testid="workspace-space-pr-panel-close"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
