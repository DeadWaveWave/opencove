import React from 'react'
import { CheckCircle2, CircleDot, ExternalLink, XCircle } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { GitHubPullRequestCheck } from '@shared/contracts/dto'

function checkIcon(bucket: GitHubPullRequestCheck['bucket']): React.JSX.Element {
  if (bucket === 'pass') {
    return (
      <CheckCircle2
        className="workspace-pr-panel__check-icon workspace-pr-panel__check-icon--pass"
        aria-hidden="true"
      />
    )
  }

  if (bucket === 'fail') {
    return (
      <XCircle
        className="workspace-pr-panel__check-icon workspace-pr-panel__check-icon--fail"
        aria-hidden="true"
      />
    )
  }

  if (bucket === 'pending') {
    return (
      <CircleDot
        className="workspace-pr-panel__check-icon workspace-pr-panel__check-icon--pending"
        aria-hidden="true"
      />
    )
  }

  return <CircleDot className="workspace-pr-panel__check-icon" aria-hidden="true" />
}

export function WorkspaceSpacePullRequestPanelChecks({
  isLoading,
  checks,
}: {
  isLoading: boolean
  checks: GitHubPullRequestCheck[] | null
}): React.JSX.Element {
  const { t } = useTranslation()

  if (isLoading) {
    return <div className="workspace-pr-panel__loading">{t('common.loading')}</div>
  }

  if (checks && checks.length > 0) {
    return (
      <div className="workspace-pr-panel__checks" data-testid="workspace-space-pr-panel-checks">
        {checks.map(check => (
          <div key={check.name} className="workspace-pr-panel__check-row">
            {checkIcon(check.bucket)}
            <div className="workspace-pr-panel__check-main">
              <div className="workspace-pr-panel__check-name">{check.name}</div>
              {check.description ? (
                <div className="workspace-pr-panel__check-desc">{check.description}</div>
              ) : null}
            </div>
            {check.link ? (
              <a
                className="workspace-pr-panel__check-link"
                href={check.link}
                target="_blank"
                rel="noreferrer"
                aria-label={t('githubPullRequest.openInBrowser')}
              >
                <ExternalLink aria-hidden="true" />
              </a>
            ) : null}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="workspace-pr-panel__empty" data-testid="workspace-space-pr-panel-checks-empty">
      {t('githubPullRequest.noChecks')}
    </div>
  )
}
