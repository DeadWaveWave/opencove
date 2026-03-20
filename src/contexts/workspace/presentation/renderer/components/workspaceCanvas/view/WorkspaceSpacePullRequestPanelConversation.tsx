import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  GitHubPullRequestAction,
  GitHubPullRequestReviewEvent,
  GitHubPullRequestSelector,
} from '@shared/contracts/dto'

type ConversationMode = 'comment' | 'review' | null

export function WorkspaceSpacePullRequestPanelConversation({
  branch,
  isAvailable,
  isExecutingAction,
  selector,
  executeAction,
  commentBody,
  setCommentBody,
  reviewBody,
  setReviewBody,
}: {
  branch: string
  isAvailable: boolean
  isExecutingAction: boolean
  selector: GitHubPullRequestSelector | null
  executeAction: (action: GitHubPullRequestAction) => Promise<void>
  commentBody: string
  setCommentBody: (value: string) => void
  reviewBody: string
  setReviewBody: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = React.useState<ConversationMode>(null)

  React.useEffect(() => {
    setMode(null)
    setCommentBody('')
    setReviewBody('')
  }, [branch, setCommentBody, setReviewBody])

  const toggleMode = (next: ConversationMode): void => {
    setMode(previous => (previous === next ? null : next))
  }

  return (
    <div className="workspace-pr-panel__conversation">
      <div className="workspace-pr-panel__conversation-header">
        <div className="workspace-pr-panel__conversation-title">
          {t('githubPullRequest.comment')}
        </div>
        <div className="workspace-pr-panel__conversation-actions">
          <button
            type="button"
            className={
              mode === 'comment'
                ? 'workspace-pr-panel__conversation-toggle workspace-pr-panel__conversation-toggle--active'
                : 'workspace-pr-panel__conversation-toggle'
            }
            disabled={!isAvailable || isExecutingAction || !selector}
            onClick={() => toggleMode('comment')}
          >
            {t('githubPullRequest.comment')}
          </button>
          <button
            type="button"
            className={
              mode === 'review'
                ? 'workspace-pr-panel__conversation-toggle workspace-pr-panel__conversation-toggle--active'
                : 'workspace-pr-panel__conversation-toggle'
            }
            disabled={!isAvailable || isExecutingAction || !selector}
            onClick={() => toggleMode('review')}
          >
            {t('githubPullRequest.review')}
          </button>
        </div>
      </div>

      {mode === 'comment' ? (
        <div className="cove-window__field-row workspace-pr-panel__conversation-body">
          <textarea
            data-testid="workspace-space-pr-panel-comment-input"
            value={commentBody}
            disabled={!isAvailable || isExecutingAction}
            placeholder={t('githubPullRequest.commentPlaceholder')}
            onChange={event => setCommentBody(event.target.value)}
          />
          <div className="workspace-pr-panel__inline-actions">
            <button
              type="button"
              className="cove-window__action cove-window__action--secondary"
              data-testid="workspace-space-pr-panel-action-comment"
              disabled={
                !isAvailable || isExecutingAction || !selector || commentBody.trim().length === 0
              }
              onClick={() => {
                if (!selector) {
                  return
                }

                void executeAction({
                  kind: 'comment',
                  selector,
                  body: commentBody.trim(),
                }).then(() => {
                  setCommentBody('')
                  setMode(null)
                })
              }}
            >
              {t('githubPullRequest.addComment')}
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'review' ? (
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
                  disabled={
                    !isAvailable || isExecutingAction || !selector || reviewBody.trim().length === 0
                  }
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
                      setMode(null)
                    })
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
