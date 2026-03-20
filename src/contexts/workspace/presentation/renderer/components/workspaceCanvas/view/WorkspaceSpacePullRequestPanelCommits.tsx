import React from 'react'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { toRelativeTime } from '@app/renderer/shell/utils/format'
import type { GitHubPullRequestCommit } from '@shared/contracts/dto'

function toShortSha(oid: string): string {
  return oid.trim().slice(0, 7)
}

function formatCommitAuthor(commit: GitHubPullRequestCommit): string | null {
  const login = commit.authorLogin?.trim()
  if (login) {
    return `@${login}`
  }

  const name = commit.authorName?.trim()
  return name && name.length > 0 ? name : null
}

export function WorkspaceSpacePullRequestPanelCommits({
  isLoading,
  commits,
}: {
  isLoading: boolean
  commits: GitHubPullRequestCommit[] | null | undefined
}): React.JSX.Element {
  const { t } = useTranslation()

  if (isLoading) {
    return <div className="workspace-pr-panel__section-empty">{t('common.loading')}</div>
  }

  if (!commits) {
    return (
      <div
        className="workspace-pr-panel__section-empty"
        data-testid="workspace-space-pr-panel-commits-empty"
      >
        {t('githubPullRequest.commitsUnavailable')}
      </div>
    )
  }

  if (commits.length === 0) {
    return (
      <div
        className="workspace-pr-panel__section-empty"
        data-testid="workspace-space-pr-panel-commits-empty"
      >
        {t('githubPullRequest.noCommits')}
      </div>
    )
  }

  return (
    <div className="workspace-pr-panel__commits" data-testid="workspace-space-pr-panel-commits">
      {commits.map(commit => {
        const author = formatCommitAuthor(commit)
        const relativeTime = commit.committedDate ? toRelativeTime(commit.committedDate) : null

        return (
          <div key={commit.oid} className="workspace-pr-panel__commit-row">
            <div className="workspace-pr-panel__commit-main">
              <div className="workspace-pr-panel__commit-message">{commit.headline}</div>
              <div className="workspace-pr-panel__commit-meta">
                <span className="workspace-pr-panel__commit-sha">{toShortSha(commit.oid)}</span>
                {author ? <span>{author}</span> : null}
                {relativeTime ? <span>{relativeTime}</span> : null}
              </div>
            </div>

            {commit.url ? (
              <a
                className="workspace-pr-panel__commit-link"
                href={commit.url}
                target="_blank"
                rel="noreferrer"
                aria-label={t('githubPullRequest.openInBrowser')}
              >
                <ExternalLink aria-hidden="true" />
              </a>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
