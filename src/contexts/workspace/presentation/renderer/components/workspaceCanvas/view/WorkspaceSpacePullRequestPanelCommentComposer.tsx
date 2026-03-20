import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { GitHubPullRequestAction, GitHubPullRequestSelector } from '@shared/contracts/dto'

export function WorkspaceSpacePullRequestPanelCommentComposer({
  branch,
  isAvailable,
  isExecutingAction,
  selector,
  executeAction,
  commentBody,
  setCommentBody,
}: {
  branch: string
  isAvailable: boolean
  isExecutingAction: boolean
  selector: GitHubPullRequestSelector | null
  executeAction: (action: GitHubPullRequestAction) => Promise<void>
  commentBody: string
  setCommentBody: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  React.useEffect(() => {
    setIsExpanded(false)
    setCommentBody('')
  }, [branch, setCommentBody])

  React.useEffect(() => {
    if (!isExpanded) {
      return
    }

    const handle = window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(handle)
    }
  }, [isExpanded])

  const canCompose = isAvailable && !isExecutingAction && Boolean(selector)

  return (
    <div className="workspace-pr-panel__conversation">
      {!isExpanded ? (
        <button
          type="button"
          className="workspace-pr-panel__composer-collapsed"
          disabled={!canCompose}
          onClick={() => setIsExpanded(true)}
        >
          <span className="workspace-pr-panel__composer-placeholder">
            {t('githubPullRequest.commentPlaceholder')}
          </span>
          <span className="workspace-pr-panel__composer-cta">{t('githubPullRequest.comment')}</span>
        </button>
      ) : (
        <div className="cove-window__field-row workspace-pr-panel__composer-expanded">
          <textarea
            data-testid="workspace-space-pr-panel-comment-input"
            value={commentBody}
            ref={textareaRef}
            disabled={!isAvailable || isExecutingAction}
            placeholder={t('githubPullRequest.commentPlaceholder')}
            onChange={event => setCommentBody(event.target.value)}
          />
          <div className="workspace-pr-panel__inline-actions">
            <button
              type="button"
              className="cove-window__action cove-window__action--secondary"
              data-testid="workspace-space-pr-panel-action-comment"
              disabled={!canCompose || commentBody.trim().length === 0}
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
                  setIsExpanded(false)
                })
              }}
            >
              {t('githubPullRequest.addComment')}
            </button>

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
      )}
    </div>
  )
}
