import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  GitHubPullRequestAction,
  GitHubPullRequestReviewEvent,
  GitHubPullRequestSelector,
} from '@shared/contracts/dto'

export function WorkspaceSpacePullRequestPanelReviewComposer({
  branch,
  isAvailable,
  isExecutingAction,
  selector,
  executeAction,
  reviewBody,
  setReviewBody,
  isReviewable,
}: {
  branch: string
  isAvailable: boolean
  isExecutingAction: boolean
  selector: GitHubPullRequestSelector | null
  executeAction: (action: GitHubPullRequestAction) => Promise<void>
  reviewBody: string
  setReviewBody: (value: string) => void
  isReviewable: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = React.useState(false)

  React.useEffect(() => {
    setIsExpanded(false)
    setReviewBody('')
  }, [branch, setReviewBody])

  const canCompose = isAvailable && !isExecutingAction && Boolean(selector) && isReviewable
  const hasBody = reviewBody.trim().length > 0

  return (
    <div className="workspace-pr-panel__conversation">
      <div className="workspace-pr-panel__conversation-header">
        <div className="workspace-pr-panel__conversation-title">
          {t('githubPullRequest.review')}
        </div>
        <div className="workspace-pr-panel__conversation-actions">
          <button
            type="button"
            className="workspace-pr-panel__conversation-toggle"
            disabled={!canCompose}
            onClick={() => {
              setIsExpanded(previous => !previous)
            }}
          >
            {isExpanded ? t('common.cancel') : t('githubPullRequest.review')}
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="cove-window__field-row workspace-pr-panel__conversation-body">
          <textarea
            data-testid="workspace-space-pr-panel-review-input"
            value={reviewBody}
            disabled={!isAvailable || isExecutingAction}
            placeholder={t('githubPullRequest.reviewPlaceholder')}
            onChange={event => setReviewBody(event.target.value)}
          />
          <div className="workspace-pr-panel__inline-actions">
            {(['approve', 'request_changes', 'comment'] as const).map(eventName => {
              const label =
                eventName === 'approve'
                  ? t('githubPullRequest.approve')
                  : eventName === 'request_changes'
                    ? t('githubPullRequest.requestChanges')
                    : t('githubPullRequest.reviewComment')

              return (
                <button
                  key={eventName}
                  type="button"
                  className="cove-window__action cove-window__action--secondary"
                  data-testid={`workspace-space-pr-panel-action-review-${eventName}`}
                  disabled={!canCompose || !hasBody}
                  onClick={() => {
                    if (!selector) {
                      return
                    }

                    void executeAction({
                      kind: 'review',
                      selector,
                      event: eventName as GitHubPullRequestReviewEvent,
                      body: reviewBody.trim(),
                    }).then(() => {
                      setReviewBody('')
                      setIsExpanded(false)
                    })
                  }}
                >
                  {label}
                </button>
              )
            })}

            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              disabled={isExecutingAction}
              onClick={() => {
                setIsExpanded(false)
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
