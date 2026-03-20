import React from 'react'
import { CheckCircle2, CircleDot, ExternalLink, XCircle } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { GitHubPullRequestCheck } from '@shared/contracts/dto'

function resolveCiBucket(checks: GitHubPullRequestCheck[]): GitHubPullRequestCheck['bucket'] {
  if (checks.some(check => check.bucket === 'fail')) {
    return 'fail'
  }

  if (checks.some(check => check.bucket === 'pending')) {
    return 'pending'
  }

  if (checks.some(check => check.bucket === 'pass')) {
    return 'pass'
  }

  return null
}

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

function countBuckets(checks: GitHubPullRequestCheck[]): Record<string, number> {
  const stats: Record<string, number> = {
    pass: 0,
    fail: 0,
    pending: 0,
    skipping: 0,
    cancel: 0,
    unknown: 0,
  }

  checks.forEach(check => {
    const bucket = check.bucket ?? 'unknown'
    stats[bucket] = (stats[bucket] ?? 0) + 1
  })

  return stats
}

export function WorkspaceSpacePullRequestPanelCiSummary({
  isLoading,
  checks,
  onOpenChecksTab,
}: {
  isLoading: boolean
  checks: GitHubPullRequestCheck[] | null
  onOpenChecksTab?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="workspace-pr-panel__overview-row">
        <div className="workspace-pr-panel__overview-row-label">{t('githubPullRequest.ci')}</div>
        <div className="workspace-pr-panel__overview-row-value">{t('common.loading')}</div>
      </div>
    )
  }

  if (!checks) {
    return (
      <div className="workspace-pr-panel__overview-row">
        <div className="workspace-pr-panel__overview-row-label">{t('githubPullRequest.ci')}</div>
        <div className="workspace-pr-panel__overview-row-value">{t('common.loading')}</div>
      </div>
    )
  }

  if (checks.length === 0) {
    return (
      <div className="workspace-pr-panel__overview-row">
        <div className="workspace-pr-panel__overview-row-label">{t('githubPullRequest.ci')}</div>
        <div className="workspace-pr-panel__overview-row-value">
          {t('githubPullRequest.noChecks')}
        </div>
      </div>
    )
  }

  const stats = countBuckets(checks)
  const bucket = resolveCiBucket(checks)
  const summary = `${stats.pass ? `${stats.pass} ✓` : ''}${stats.fail ? `${stats.fail} ✕` : ''}${
    stats.pending ? `${stats.pending} …` : ''
  }`.trim()

  const openExternalLink =
    checks.find(check => typeof check.link === 'string' && check.link.length > 0)?.link ?? null

  return (
    <div className="workspace-pr-panel__overview-row">
      <div className="workspace-pr-panel__overview-row-label">{t('githubPullRequest.ci')}</div>
      <div className="workspace-pr-panel__overview-row-value">
        {checkIcon(bucket)} {summary || t('githubPullRequest.noChecks')}
      </div>
      {onOpenChecksTab ? (
        <button
          type="button"
          className="workspace-pr-panel__overview-row-action"
          onClick={onOpenChecksTab}
        >
          {t('githubPullRequest.checks')}
        </button>
      ) : null}
      {openExternalLink ? (
        <a
          className="workspace-pr-panel__overview-row-action"
          href={openExternalLink}
          target="_blank"
          rel="noreferrer"
          aria-label={t('githubPullRequest.openInBrowser')}
        >
          <ExternalLink aria-hidden="true" />
        </a>
      ) : null}
    </div>
  )
}
