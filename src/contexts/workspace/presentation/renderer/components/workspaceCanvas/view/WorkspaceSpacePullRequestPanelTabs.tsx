import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceSpacePullRequestPanelTab } from './WorkspaceSpacePullRequestPanel'

export function WorkspaceSpacePullRequestPanelTabs({
  tab,
  setTab,
  hasPullRequest,
}: {
  tab: WorkspaceSpacePullRequestPanelTab
  setTab: (tab: WorkspaceSpacePullRequestPanelTab) => void
  hasPullRequest: boolean
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className="workspace-pr-panel__tabs"
      role="tablist"
      aria-label={t('githubPullRequest.tabs')}
    >
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'overview'}
        className={
          tab === 'overview'
            ? 'workspace-pr-panel__tab workspace-pr-panel__tab--active'
            : 'workspace-pr-panel__tab'
        }
        data-testid="workspace-space-pr-panel-tab-overview"
        onClick={() => {
          setTab('overview')
        }}
      >
        {t('githubPullRequest.overview')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'commits'}
        className={
          tab === 'commits'
            ? 'workspace-pr-panel__tab workspace-pr-panel__tab--active'
            : 'workspace-pr-panel__tab'
        }
        data-testid="workspace-space-pr-panel-tab-commits"
        disabled={!hasPullRequest}
        onClick={() => {
          setTab('commits')
        }}
      >
        {t('githubPullRequest.commits')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'checks'}
        className={
          tab === 'checks'
            ? 'workspace-pr-panel__tab workspace-pr-panel__tab--active'
            : 'workspace-pr-panel__tab'
        }
        data-testid="workspace-space-pr-panel-tab-checks"
        disabled={!hasPullRequest}
        onClick={() => {
          setTab('checks')
        }}
      >
        {t('githubPullRequest.checks')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'diff'}
        className={
          tab === 'diff'
            ? 'workspace-pr-panel__tab workspace-pr-panel__tab--active'
            : 'workspace-pr-panel__tab'
        }
        data-testid="workspace-space-pr-panel-tab-diff"
        disabled={!hasPullRequest}
        onClick={() => {
          setTab('diff')
        }}
      >
        {t('githubPullRequest.diff')}
      </button>
    </div>
  )
}
