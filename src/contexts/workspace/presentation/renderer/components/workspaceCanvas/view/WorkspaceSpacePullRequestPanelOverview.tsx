import React from 'react'
import { GitMerge } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  GitHubPullRequestAction,
  GitHubPullRequestDetails,
  GitHubPullRequestReviewEvent,
  GitHubPullRequestSelector,
  GitHubPullRequestSummary,
} from '@shared/contracts/dto'
import type { WorkspaceSpacePullRequestPanelState } from './WorkspaceSpacePullRequestPanel'

export function WorkspaceSpacePullRequestPanelOverview({
  panel,
  summary,
  details,
  isAvailable,
  isExecutingAction,
  selectorForExisting,
  pendingConfirmation,
  setPendingConfirmation,
  executeAction,
  actionError,
  createTitle,
  setCreateTitle,
  createBody,
  setCreateBody,
  createBase,
  setCreateBase,
  baseBranchSuggestions,
  createDraft,
  setCreateDraft,
  commentBody,
  setCommentBody,
  reviewBody,
  setReviewBody,
}: {
  panel: WorkspaceSpacePullRequestPanelState
  summary: GitHubPullRequestSummary | null
  details: GitHubPullRequestDetails | null
  isAvailable: boolean
  isExecutingAction: boolean
  selectorForExisting: GitHubPullRequestSelector | null
  pendingConfirmation: { label: string; action: GitHubPullRequestAction } | null
  setPendingConfirmation: (next: { label: string; action: GitHubPullRequestAction } | null) => void
  executeAction: (action: GitHubPullRequestAction) => Promise<void>
  actionError: string | null
  createTitle: string
  setCreateTitle: (value: string) => void
  createBody: string
  setCreateBody: (value: string) => void
  createBase: string
  setCreateBase: (value: string) => void
  baseBranchSuggestions: string[]
  createDraft: boolean
  setCreateDraft: (value: boolean) => void
  commentBody: string
  setCommentBody: (value: string) => void
  reviewBody: string
  setReviewBody: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [showAdvanced, setShowAdvanced] = React.useState(false)

  React.useEffect(() => {
    setShowAdvanced(false)
  }, [panel.branch])

  if (summary) {
    return (
      <>
        <div className="workspace-pr-panel__overview-header">
          <div
            className="workspace-pr-panel__overview-title"
            data-testid="workspace-space-pr-panel-pr-title"
          >
            {summary.title}
          </div>
          <div className="workspace-pr-panel__overview-meta">
            <span className="workspace-pr-panel__overview-meta-item">
              {t('githubPullRequest.branch', { branch: panel.branch })}
            </span>
            {summary.baseRefName ? (
              <span className="workspace-pr-panel__overview-meta-item">
                {t('githubPullRequest.base', { base: summary.baseRefName })}
              </span>
            ) : null}
            {summary.isDraft ? (
              <span className="workspace-pr-panel__badge">{t('githubPullRequest.draft')}</span>
            ) : null}
            {summary.state !== 'open' ? (
              <span className="workspace-pr-panel__badge">
                {summary.state === 'merged'
                  ? t('githubPullRequest.state.merged')
                  : t('githubPullRequest.state.closed')}
              </span>
            ) : null}
          </div>
        </div>

        {details?.body ? (
          <div
            className="workspace-pr-panel__body-text"
            data-testid="workspace-space-pr-panel-pr-body"
          >
            {details.body}
          </div>
        ) : null}

        {pendingConfirmation ? (
          <div className="workspace-pr-panel__confirm">
            <div className="workspace-pr-panel__confirm-text">{pendingConfirmation.label}</div>
            <div className="workspace-pr-panel__confirm-actions">
              <button
                type="button"
                className="cove-window__action cove-window__action--danger"
                data-testid="workspace-space-pr-panel-confirm-yes"
                disabled={!isAvailable || isExecutingAction}
                onClick={() => {
                  void executeAction(pendingConfirmation.action)
                }}
              >
                {t('common.confirm')}
              </button>
              <button
                type="button"
                className="cove-window__action cove-window__action--ghost"
                data-testid="workspace-space-pr-panel-confirm-cancel"
                disabled={isExecutingAction}
                onClick={() => {
                  setPendingConfirmation(null)
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="workspace-pr-panel__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--secondary"
            data-testid="workspace-space-pr-panel-action-ready"
            disabled={!isAvailable || isExecutingAction || !selectorForExisting}
            onClick={() => {
              if (!selectorForExisting) {
                return
              }

              const wantsDraft = !summary.isDraft
              void executeAction({
                kind: 'set_ready',
                selector: selectorForExisting,
                isDraft: wantsDraft,
              })
            }}
          >
            {summary.isDraft
              ? t('githubPullRequest.markReady')
              : t('githubPullRequest.convertToDraft')}
          </button>

          <button
            type="button"
            className="cove-window__action cove-window__action--primary"
            data-testid="workspace-space-pr-panel-action-merge"
            disabled={
              !isAvailable || isExecutingAction || summary.state !== 'open' || !selectorForExisting
            }
            onClick={() => {
              if (!selectorForExisting) {
                return
              }

              setPendingConfirmation({
                label: t('githubPullRequest.confirmMerge'),
                action: {
                  kind: 'merge',
                  selector: selectorForExisting,
                  method: 'merge',
                  auto: false,
                  deleteBranch: false,
                  subject: null,
                  body: null,
                  admin: false,
                },
              })
            }}
          >
            <GitMerge className="workspace-pr-panel__action-icon" aria-hidden="true" />
            {t('githubPullRequest.merge')}
          </button>

          {summary.state === 'open' ? (
            <button
              type="button"
              className="cove-window__action cove-window__action--danger"
              data-testid="workspace-space-pr-panel-action-close"
              disabled={!isAvailable || isExecutingAction || !selectorForExisting}
              onClick={() => {
                if (!selectorForExisting) {
                  return
                }

                setPendingConfirmation({
                  label: t('githubPullRequest.confirmClose'),
                  action: {
                    kind: 'close',
                    selector: selectorForExisting,
                    deleteBranch: false,
                    comment: null,
                  },
                })
              }}
            >
              {t('githubPullRequest.close')}
            </button>
          ) : (
            <button
              type="button"
              className="cove-window__action cove-window__action--secondary"
              data-testid="workspace-space-pr-panel-action-reopen"
              disabled={!isAvailable || isExecutingAction || !selectorForExisting}
              onClick={() => {
                if (!selectorForExisting) {
                  return
                }

                void executeAction({ kind: 'reopen', selector: selectorForExisting })
              }}
            >
              {t('githubPullRequest.reopen')}
            </button>
          )}
        </div>

        <div className="workspace-pr-panel__form-grid">
          <div className="cove-window__field-row">
            <label htmlFor="workspace-space-pr-comment">{t('githubPullRequest.comment')}</label>
            <textarea
              id="workspace-space-pr-comment"
              data-testid="workspace-space-pr-panel-comment-input"
              value={commentBody}
              disabled={!isAvailable || isExecutingAction}
              placeholder={t('githubPullRequest.commentPlaceholder')}
              onChange={event => {
                setCommentBody(event.target.value)
              }}
            />
            <div className="workspace-pr-panel__inline-actions">
              <button
                type="button"
                className="cove-window__action cove-window__action--secondary"
                data-testid="workspace-space-pr-panel-action-comment"
                disabled={
                  !isAvailable ||
                  isExecutingAction ||
                  !selectorForExisting ||
                  commentBody.trim().length === 0
                }
                onClick={() => {
                  if (!selectorForExisting) {
                    return
                  }

                  void executeAction({
                    kind: 'comment',
                    selector: selectorForExisting,
                    body: commentBody.trim(),
                  }).then(() => {
                    setCommentBody('')
                  })
                }}
              >
                {t('githubPullRequest.addComment')}
              </button>
            </div>
          </div>

          <div className="cove-window__field-row">
            <label htmlFor="workspace-space-pr-review">{t('githubPullRequest.review')}</label>
            <textarea
              id="workspace-space-pr-review"
              data-testid="workspace-space-pr-panel-review-input"
              value={reviewBody}
              disabled={!isAvailable || isExecutingAction}
              placeholder={t('githubPullRequest.reviewPlaceholder')}
              onChange={event => {
                setReviewBody(event.target.value)
              }}
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
                      !isAvailable ||
                      isExecutingAction ||
                      !selectorForExisting ||
                      reviewBody.trim().length === 0
                    }
                    onClick={() => {
                      if (!selectorForExisting) {
                        return
                      }

                      void executeAction({
                        kind: 'review',
                        selector: selectorForExisting,
                        event: eventName as GitHubPullRequestReviewEvent,
                        body: reviewBody.trim(),
                      }).then(() => {
                        setReviewBody('')
                      })
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {actionError ? (
          <div className="cove-window__error" data-testid="workspace-space-pr-panel-action-error">
            {actionError}
          </div>
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className="workspace-pr-panel__empty">
        <div className="workspace-pr-panel__empty-title">
          {t('githubPullRequest.noPullRequest')}
        </div>
        <div className="workspace-pr-panel__empty-meta">
          {t('githubPullRequest.branch', { branch: panel.branch })}
        </div>
      </div>

      <div className="workspace-pr-panel__form-grid">
        <div className="cove-window__field-row">
          <label htmlFor="workspace-space-pr-create-title">
            {t('githubPullRequest.createTitle')}
          </label>
          <input
            id="workspace-space-pr-create-title"
            data-testid="workspace-space-pr-panel-create-title"
            value={createTitle}
            disabled={!isAvailable || isExecutingAction}
            onChange={event => {
              setCreateTitle(event.target.value)
            }}
          />
        </div>

        <div className="cove-window__field-row">
          <label htmlFor="workspace-space-pr-create-base">
            {t('githubPullRequest.createBase')}
          </label>
          <input
            id="workspace-space-pr-create-base"
            data-testid="workspace-space-pr-panel-create-base"
            value={createBase}
            list={
              baseBranchSuggestions.length > 0
                ? 'workspace-space-pr-create-base-options'
                : undefined
            }
            disabled={!isAvailable || isExecutingAction}
            placeholder={t('githubPullRequest.createBasePlaceholder')}
            onChange={event => {
              setCreateBase(event.target.value)
            }}
          />
          {baseBranchSuggestions.length > 0 ? (
            <datalist id="workspace-space-pr-create-base-options">
              {baseBranchSuggestions.map(option => (
                <option key={option} value={option} />
              ))}
            </datalist>
          ) : null}
        </div>

        <div className="cove-window__field-row">
          <label htmlFor="workspace-space-pr-create-body">
            {t('githubPullRequest.createBody')}
          </label>
          <textarea
            id="workspace-space-pr-create-body"
            data-testid="workspace-space-pr-panel-create-body"
            value={createBody}
            disabled={!isAvailable || isExecutingAction}
            placeholder={t('githubPullRequest.createBodyPlaceholder')}
            onChange={event => {
              setCreateBody(event.target.value)
            }}
          />
        </div>

        <label className="cove-window__checkbox">
          <input
            type="checkbox"
            data-testid="workspace-space-pr-panel-create-draft"
            checked={createDraft}
            disabled={!isAvailable || isExecutingAction}
            onChange={event => {
              setCreateDraft(event.target.checked)
            }}
          />
          {t('githubPullRequest.createDraft')}
        </label>

        <div className="workspace-pr-panel__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            onClick={() => setShowAdvanced(previous => !previous)}
          >
            {showAdvanced ? t('githubPullRequest.hideAdvanced') : t('githubPullRequest.advanced')}
          </button>

          {showAdvanced ? (
            <button
              type="button"
              className="cove-window__action cove-window__action--secondary"
              data-testid="workspace-space-pr-panel-action-publish-branch"
              disabled={!isAvailable || isExecutingAction}
              onClick={() => {
                void executeAction({ kind: 'publish_branch', branch: panel.branch, remote: null })
              }}
            >
              {t('githubPullRequest.publishBranch')}
            </button>
          ) : null}

          <button
            type="button"
            className="cove-window__action cove-window__action--primary"
            data-testid="workspace-space-pr-panel-action-create"
            disabled={!isAvailable || isExecutingAction || createTitle.trim().length === 0}
            onClick={() => {
              void executeAction({
                kind: 'create',
                branch: panel.branch,
                title: createTitle.trim(),
                body: createBody,
                base: createBase.trim() || null,
                draft: createDraft,
              })
            }}
          >
            {t('githubPullRequest.create')}
          </button>
        </div>

        {actionError ? (
          <div className="cove-window__error" data-testid="workspace-space-pr-panel-action-error">
            {actionError}
          </div>
        ) : null}
      </div>
    </>
  )
}
