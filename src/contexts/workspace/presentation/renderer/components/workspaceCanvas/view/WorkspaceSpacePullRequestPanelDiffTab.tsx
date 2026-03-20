import React from 'react'
import type {
  GitHubPullRequestAction,
  GitHubPullRequestSelector,
  GitHubPullRequestSummary,
} from '@shared/contracts/dto'
import { WorkspaceSpacePullRequestPanelDiff } from './WorkspaceSpacePullRequestPanelDiff'
import { WorkspaceSpacePullRequestPanelReviewComposer } from './WorkspaceSpacePullRequestPanelReviewComposer'

export function WorkspaceSpacePullRequestPanelDiffTab({
  branch,
  summary,
  isLoadingDiff,
  diff,
  isAvailable,
  isExecutingAction,
  selectorForExisting,
  executeAction,
  reviewBody,
  setReviewBody,
}: {
  branch: string
  summary: GitHubPullRequestSummary | null
  isLoadingDiff: boolean
  diff: string | null
  isAvailable: boolean
  isExecutingAction: boolean
  selectorForExisting: GitHubPullRequestSelector | null
  executeAction: (action: GitHubPullRequestAction) => Promise<void>
  reviewBody: string
  setReviewBody: (value: string) => void
}): React.JSX.Element {
  return (
    <>
      <WorkspaceSpacePullRequestPanelDiff isLoading={isLoadingDiff} diff={diff} />
      <WorkspaceSpacePullRequestPanelReviewComposer
        branch={branch}
        isAvailable={isAvailable}
        isExecutingAction={isExecutingAction}
        selector={selectorForExisting}
        executeAction={executeAction}
        reviewBody={reviewBody}
        setReviewBody={setReviewBody}
        isReviewable={summary?.state === 'open'}
      />
    </>
  )
}
