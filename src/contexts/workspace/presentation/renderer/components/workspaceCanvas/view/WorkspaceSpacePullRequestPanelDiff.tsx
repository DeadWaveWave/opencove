import React from 'react'
import { useTranslation } from '@app/renderer/i18n'

export function WorkspaceSpacePullRequestPanelDiff({
  isLoading,
  diff,
}: {
  isLoading: boolean
  diff: string | null
}): React.JSX.Element {
  const { t } = useTranslation()

  if (isLoading) {
    return <div className="workspace-pr-panel__loading">{t('common.loading')}</div>
  }

  if (diff) {
    return (
      <pre className="workspace-pr-panel__diff" data-testid="workspace-space-pr-panel-diff">
        {diff}
      </pre>
    )
  }

  return (
    <div className="workspace-pr-panel__empty" data-testid="workspace-space-pr-panel-diff-empty">
      {t('githubPullRequest.noDiff')}
    </div>
  )
}
