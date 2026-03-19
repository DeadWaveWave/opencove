import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  GitHubPullRequestAction,
  GitHubPullRequestCheck,
  GitHubPullRequestDetails,
  GitHubPullRequestSelector,
  GitHubPullRequestSummary,
  IntegrationProviderAvailability,
} from '@shared/contracts/dto'
import { toErrorMessage } from '../helpers'
import { WorkspaceSpacePullRequestPanelChecks } from './WorkspaceSpacePullRequestPanelChecks'
import { WorkspaceSpacePullRequestPanelDiff } from './WorkspaceSpacePullRequestPanelDiff'
import { WorkspaceSpacePullRequestPanelHeader } from './WorkspaceSpacePullRequestPanelHeader'
import { WorkspaceSpacePullRequestPanelOverview } from './WorkspaceSpacePullRequestPanelOverview'
import { WorkspaceSpacePullRequestPanelTabs } from './WorkspaceSpacePullRequestPanelTabs'
import { usePullRequestBaseBranchSuggestions } from './usePullRequestBaseBranchSuggestions'

export interface WorkspaceSpacePullRequestPanelState {
  spaceId: string
  spaceName: string
  branch: string
  anchor: { x: number; y: number }
  summary: GitHubPullRequestSummary | null
}

export type WorkspaceSpacePullRequestPanelTab = 'overview' | 'checks' | 'diff'

const PANEL_WIDTH = 520
const PANEL_MAX_HEIGHT = 560
const VIEWPORT_PADDING = 12

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function canExecuteActions(availability: IntegrationProviderAvailability | null): boolean {
  return availability?.kind === 'available'
}

export function WorkspaceSpacePullRequestPanel({
  panel,
  repoPath,
  pullRequestBaseBranchOptions,
  availability,
  closePanel,
  onAvailabilityChange,
  onPullRequestSummaryChange,
}: {
  panel: WorkspaceSpacePullRequestPanelState | null
  repoPath: string
  pullRequestBaseBranchOptions: string[]
  availability: IntegrationProviderAvailability | null
  closePanel: () => void
  onAvailabilityChange?: (availability: IntegrationProviderAvailability) => void
  onPullRequestSummaryChange?: (branch: string, summary: GitHubPullRequestSummary | null) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [tab, setTab] = React.useState<WorkspaceSpacePullRequestPanelTab>('overview')
  const [resolvedAvailability, setResolvedAvailability] =
    React.useState<IntegrationProviderAvailability | null>(availability)
  const [summary, setSummary] = React.useState<GitHubPullRequestSummary | null>(
    panel?.summary ?? null,
  )
  const [details, setDetails] = React.useState<GitHubPullRequestDetails | null>(null)
  const [checks, setChecks] = React.useState<GitHubPullRequestCheck[] | null>(null)
  const [diff, setDiff] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isLoadingChecks, setIsLoadingChecks] = React.useState(false)
  const [isLoadingDiff, setIsLoadingDiff] = React.useState(false)
  const [isExecutingAction, setIsExecutingAction] = React.useState(false)
  const [pendingConfirmation, setPendingConfirmation] = React.useState<{
    label: string
    action: GitHubPullRequestAction
  } | null>(null)

  const [createTitle, setCreateTitle] = React.useState('')
  const [createBody, setCreateBody] = React.useState('')
  const [createBase, setCreateBase] = React.useState('')
  const [createDraft, setCreateDraft] = React.useState(true)

  const [commentBody, setCommentBody] = React.useState('')
  const [reviewBody, setReviewBody] = React.useState('')

  const baseBranchSuggestions = usePullRequestBaseBranchSuggestions({
    panel,
    repoPath,
    pullRequestBaseBranchOptions,
    setCreateBase,
  })

  React.useEffect(() => {
    setResolvedAvailability(availability)
  }, [availability])

  React.useEffect(() => {
    if (!panel) {
      return
    }

    setTab('overview')
    setSummary(panel.summary)
    setDetails(null)
    setChecks(null)
    setDiff(null)
    setLoadError(null)
    setActionError(null)
    setIsLoading(false)
    setIsLoadingChecks(false)
    setIsLoadingDiff(false)
    setIsExecutingAction(false)
    setPendingConfirmation(null)

    setCreateTitle(panel.spaceName.trim() || panel.branch)
    setCreateBody('')
    setCreateBase('')
    setCreateDraft(true)

    setCommentBody('')
    setReviewBody('')
  }, [panel])

  React.useEffect(() => {
    if (!panel) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePanel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closePanel, panel])

  React.useEffect(() => {
    if (!panel) {
      return
    }

    const handlePointerDownCapture = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      if (target.closest('.workspace-pr-panel')) {
        return
      }

      if (target.closest('.workspace-space-region__pr-chip')) {
        return
      }

      closePanel()
    }

    window.addEventListener('pointerdown', handlePointerDownCapture, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', handlePointerDownCapture, { capture: true })
    }
  }, [closePanel, panel])

  const setAvailabilityFromResult = React.useCallback(
    (next: IntegrationProviderAvailability) => {
      setResolvedAvailability(next)
      onAvailabilityChange?.(next)
    },
    [onAvailabilityChange],
  )

  const loadPullRequest = React.useCallback(
    async (options?: { clearSections?: boolean }) => {
      if (!panel) {
        return
      }

      const getPullRequest = window.opencoveApi?.integration?.github?.getPullRequest
      if (typeof getPullRequest !== 'function') {
        setAvailabilityFromResult({
          providerId: 'github',
          kind: 'unavailable',
          reason: 'unknown',
          message: t('githubPullRequest.apiUnavailable'),
        })
        setLoadError(t('githubPullRequest.apiUnavailable'))
        return
      }

      setIsLoading(true)
      setLoadError(null)
      setPendingConfirmation(null)

      if (options?.clearSections) {
        setChecks(null)
        setDiff(null)
      }

      try {
        const result = await getPullRequest({
          repoPath,
          selector: { kind: 'branch', branch: panel.branch },
        })
        setAvailabilityFromResult(result.availability)

        const nextDetails = result.pullRequest ?? null
        setDetails(nextDetails)
        setSummary(nextDetails)
        onPullRequestSummaryChange?.(panel.branch, nextDetails)
      } catch (error) {
        setLoadError(toErrorMessage(error))
      } finally {
        setIsLoading(false)
      }
    },
    [onPullRequestSummaryChange, panel, repoPath, setAvailabilityFromResult, t],
  )

  const loadPullRequestChecks = React.useCallback(async () => {
    if (!panel) {
      return
    }

    if (!summary) {
      return
    }

    const getPullRequestChecks = window.opencoveApi?.integration?.github?.getPullRequestChecks
    if (typeof getPullRequestChecks !== 'function') {
      setLoadError(t('githubPullRequest.apiUnavailable'))
      return
    }

    setIsLoadingChecks(true)
    setLoadError(null)

    try {
      const result = await getPullRequestChecks({
        repoPath,
        selector: { kind: 'number', number: summary.number },
      })
      setAvailabilityFromResult(result.availability)
      setChecks(result.checks)
    } catch (error) {
      setLoadError(toErrorMessage(error))
    } finally {
      setIsLoadingChecks(false)
    }
  }, [panel, repoPath, setAvailabilityFromResult, summary, t])

  const loadPullRequestDiff = React.useCallback(async () => {
    if (!panel) {
      return
    }

    if (!summary) {
      return
    }

    const getPullRequestDiff = window.opencoveApi?.integration?.github?.getPullRequestDiff
    if (typeof getPullRequestDiff !== 'function') {
      setLoadError(t('githubPullRequest.apiUnavailable'))
      return
    }

    setIsLoadingDiff(true)
    setLoadError(null)

    try {
      const result = await getPullRequestDiff({
        repoPath,
        selector: { kind: 'number', number: summary.number },
      })
      setAvailabilityFromResult(result.availability)
      setDiff(result.diff)
    } catch (error) {
      setLoadError(toErrorMessage(error))
    } finally {
      setIsLoadingDiff(false)
    }
  }, [panel, repoPath, setAvailabilityFromResult, summary, t])

  React.useEffect(() => {
    if (!panel) {
      return
    }

    void loadPullRequest()
  }, [loadPullRequest, panel])

  React.useEffect(() => {
    if (!panel) {
      return
    }

    if (tab === 'checks' && checks === null && summary !== null && !isLoadingChecks) {
      void loadPullRequestChecks()
    }

    if (tab === 'diff' && diff === null && summary !== null && !isLoadingDiff) {
      void loadPullRequestDiff()
    }
  }, [
    checks,
    diff,
    isLoadingChecks,
    isLoadingDiff,
    loadPullRequestChecks,
    loadPullRequestDiff,
    panel,
    summary,
    tab,
  ])

  const executeAction = React.useCallback(
    async (action: GitHubPullRequestAction) => {
      if (!panel) {
        return
      }

      const executePullRequestAction =
        window.opencoveApi?.integration?.github?.executePullRequestAction
      if (typeof executePullRequestAction !== 'function') {
        setActionError(t('githubPullRequest.apiUnavailable'))
        return
      }

      setIsExecutingAction(true)
      setActionError(null)
      setPendingConfirmation(null)

      try {
        const result = await executePullRequestAction({ repoPath, action })

        if (result.kind === 'created') {
          setSummary(result.pullRequest)
          onPullRequestSummaryChange?.(panel.branch, result.pullRequest)
          await loadPullRequest({ clearSections: true })
          return
        }

        await loadPullRequest({ clearSections: true })
      } catch (error) {
        setActionError(toErrorMessage(error))
      } finally {
        setIsExecutingAction(false)
      }
    },
    [loadPullRequest, onPullRequestSummaryChange, panel, repoPath, t],
  )

  const isAvailable = canExecuteActions(resolvedAvailability)

  if (!panel) {
    return null
  }

  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
  const maxLeft = viewportWidth - PANEL_WIDTH - VIEWPORT_PADDING
  const maxTop = viewportHeight - PANEL_MAX_HEIGHT - VIEWPORT_PADDING
  const panelLeft = clampNumber(
    panel.anchor.x,
    VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, maxLeft),
  )
  const panelTop = clampNumber(panel.anchor.y, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, maxTop))

  const selectorForExisting: GitHubPullRequestSelector | null = summary
    ? { kind: 'number', number: summary.number }
    : null

  const renderAvailability = resolvedAvailability?.kind === 'unavailable'
  const availabilityMessage = renderAvailability ? resolvedAvailability.message : null

  return (
    <div
      className="workspace-pr-panel cove-window"
      data-testid={`workspace-space-pr-panel-${panel.spaceId}`}
      style={{
        position: 'fixed',
        top: panelTop,
        left: panelLeft,
        width: `min(${PANEL_WIDTH}px, calc(100vw - 48px))`,
        maxHeight: `min(${PANEL_MAX_HEIGHT}px, calc(100vh - 48px))`,
        zIndex: 14,
        overflow: 'hidden',
      }}
      onClick={event => {
        event.stopPropagation()
      }}
    >
      <WorkspaceSpacePullRequestPanelHeader
        summary={summary}
        isLoading={isLoading}
        onRefresh={() => {
          void loadPullRequest({ clearSections: true })
        }}
        onClose={closePanel}
      />

      <WorkspaceSpacePullRequestPanelTabs
        tab={tab}
        setTab={setTab}
        hasPullRequest={summary !== null}
      />

      <div className="workspace-pr-panel__content">
        {availabilityMessage ? (
          <div
            className="workspace-pr-panel__notice"
            data-testid="workspace-space-pr-panel-availability"
          >
            <strong className="workspace-pr-panel__notice-title">
              {t('githubPullRequest.unavailable')}
            </strong>
            <div className="workspace-pr-panel__notice-body">{availabilityMessage}</div>
          </div>
        ) : null}

        {loadError ? (
          <div className="cove-window__error" data-testid="workspace-space-pr-panel-error">
            {loadError}
          </div>
        ) : null}

        {tab === 'overview' ? (
          <WorkspaceSpacePullRequestPanelOverview
            panel={panel}
            summary={summary}
            details={details}
            isAvailable={isAvailable}
            isExecutingAction={isExecutingAction}
            selectorForExisting={selectorForExisting}
            pendingConfirmation={pendingConfirmation}
            setPendingConfirmation={setPendingConfirmation}
            executeAction={executeAction}
            actionError={actionError}
            createTitle={createTitle}
            setCreateTitle={setCreateTitle}
            createBody={createBody}
            setCreateBody={setCreateBody}
            createBase={createBase}
            setCreateBase={setCreateBase}
            baseBranchSuggestions={baseBranchSuggestions}
            createDraft={createDraft}
            setCreateDraft={setCreateDraft}
            commentBody={commentBody}
            setCommentBody={setCommentBody}
            reviewBody={reviewBody}
            setReviewBody={setReviewBody}
          />
        ) : null}

        {tab === 'checks' ? (
          <WorkspaceSpacePullRequestPanelChecks isLoading={isLoadingChecks} checks={checks} />
        ) : null}

        {tab === 'diff' ? (
          <WorkspaceSpacePullRequestPanelDiff isLoading={isLoadingDiff} diff={diff} />
        ) : null}
      </div>
    </div>
  )
}
