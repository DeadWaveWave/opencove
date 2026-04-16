import React from 'react'
import { Folder } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { GitHubPullRequestSummary, GitWorktreeInfo } from '@shared/contracts/dto'
import type { WorkspaceSpaceRect } from '../../../types'
import type { SpaceVisual } from '../types'
import type { SpaceFrameHandleMode } from '../../../utils/spaceLayout'

export interface WorkspaceSpaceBranchBadge {
  kind: string
  value: string
  title: string
}

export function WorkspaceSpaceRegionItem({
  space,
  resolvedRect,
  isSelected,
  isExplorerOpen,
  isDragSurfaceSelectionMode,
  githubPullRequestsEnabled,
  editingSpaceId,
  spaceRenameInputRef,
  spaceRenameDraft,
  setSpaceRenameDraft,
  commitSpaceRename,
  cancelSpaceRename,
  startSpaceRename,
  handleSpaceDragHandlePointerDown,
  updateHandleCursor,
  resolvedWorktreeInfo,
  allowBranchRename,
  resolvedChangedFileCount,
  resolvedBranchBadge,
  resolvedPullRequestSummary,
  onStartBranchRename,
  onToggleExplorer,
  onOpenSpaceMenu,
}: {
  space: SpaceVisual
  resolvedRect: WorkspaceSpaceRect
  isSelected: boolean
  isExplorerOpen: boolean
  isDragSurfaceSelectionMode: boolean
  githubPullRequestsEnabled: boolean
  editingSpaceId: string | null
  spaceRenameInputRef: React.RefObject<HTMLInputElement | null>
  spaceRenameDraft: string
  setSpaceRenameDraft: React.Dispatch<React.SetStateAction<string>>
  commitSpaceRename: (spaceId: string) => void
  cancelSpaceRename: () => void
  startSpaceRename: (spaceId: string) => void
  handleSpaceDragHandlePointerDown: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    spaceId: string,
    options?: { mode?: 'auto' | 'region' },
  ) => void
  updateHandleCursor: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    rect: WorkspaceSpaceRect,
    mode: SpaceFrameHandleMode,
  ) => void
  resolvedWorktreeInfo: GitWorktreeInfo | null
  allowBranchRename: boolean
  resolvedChangedFileCount: number | null
  resolvedBranchBadge: WorkspaceSpaceBranchBadge | null
  resolvedPullRequestSummary: GitHubPullRequestSummary | null
  onStartBranchRename: (payload: {
    spaceId: string
    spaceName: string
    worktreePath: string
    branchName: string
  }) => void
  onToggleExplorer?: (spaceId: string) => void
  onOpenSpaceMenu?: (spaceId: string, anchor: { x: number; y: number }) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const branchName = resolvedWorktreeInfo?.branch ?? null
  const worktreePath = resolvedWorktreeInfo?.path ?? null
  const pullRequestUrl = resolvedPullRequestSummary?.ref.url ?? null
  const shouldShowPullRequestChip =
    githubPullRequestsEnabled &&
    Boolean(branchName) &&
    Boolean(worktreePath) &&
    Boolean(pullRequestUrl) &&
    resolvedPullRequestSummary !== null

  const filesPillCount =
    typeof resolvedChangedFileCount === 'number' && Number.isFinite(resolvedChangedFileCount)
      ? Math.max(0, Math.floor(resolvedChangedFileCount))
      : null
  const filesPillCountLabel =
    filesPillCount !== null
      ? filesPillCount === 0
        ? t('worktree.clean')
        : t('worktree.changedFiles', { count: filesPillCount })
      : null
  const filesPillTitle = filesPillCountLabel
    ? `${t('spaceActions.openExplorer')} · ${filesPillCountLabel}`
    : t('spaceActions.openExplorer')
  return (
    <div
      className={
        isSelected
          ? 'workspace-space-region workspace-space-region--selected'
          : 'workspace-space-region'
      }
      data-cove-label-color={space.labelColor ?? undefined}
      style={{
        transform: `translate(${resolvedRect.x}px, ${resolvedRect.y}px)`,
        width: resolvedRect.width,
        height: resolvedRect.height,
      }}
    >
      {isSelected && isDragSurfaceSelectionMode ? (
        <div
          className="workspace-space-region__drag-surface"
          data-testid={`workspace-space-drag-surface-${space.id}`}
          onPointerDown={event => {
            handleSpaceDragHandlePointerDown(event, space.id, { mode: 'region' })
          }}
          onPointerMove={event => {
            updateHandleCursor(event, resolvedRect, 'region')
          }}
          onMouseDown={event => {
            handleSpaceDragHandlePointerDown(event, space.id, { mode: 'region' })
          }}
          onMouseMove={event => {
            updateHandleCursor(event, resolvedRect, 'region')
          }}
        />
      ) : null}
      {(['top', 'right', 'bottom', 'left'] as const).map(side => (
        <div
          key={side}
          className={`workspace-space-region__drag-handle workspace-space-region__drag-handle--${side}`}
          data-testid={`workspace-space-drag-${space.id}-${side}`}
          onPointerDown={event => {
            handleSpaceDragHandlePointerDown(event, space.id)
          }}
          onPointerMove={event => {
            updateHandleCursor(event, resolvedRect, 'auto')
          }}
          onMouseDown={event => {
            handleSpaceDragHandlePointerDown(event, space.id)
          }}
          onMouseMove={event => {
            updateHandleCursor(event, resolvedRect, 'auto')
          }}
        />
      ))}
      {editingSpaceId === space.id ? (
        <input
          ref={spaceRenameInputRef}
          className="workspace-space-region__label-input nodrag nowheel"
          data-testid={`workspace-space-label-input-${space.id}`}
          value={spaceRenameDraft}
          onPointerDown={event => {
            event.stopPropagation()
          }}
          onClick={event => {
            event.stopPropagation()
          }}
          onChange={event => {
            setSpaceRenameDraft(event.target.value)
          }}
          onBlur={() => {
            commitSpaceRename(space.id)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitSpaceRename(space.id)
              return
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              cancelSpaceRename()
            }
          }}
        />
      ) : (
        <>
          <div
            className="workspace-space-region__label-group workspace-space-region__label-group--left nodrag nowheel"
            onPointerDown={event => {
              event.stopPropagation()
            }}
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <button
              type="button"
              className="workspace-space-region__label"
              data-testid={`workspace-space-label-${space.id}`}
              onClick={event => {
                event.stopPropagation()
                startSpaceRename(space.id)
              }}
            >
              {space.labelColor ? (
                <span
                  className="cove-label-dot cove-label-dot--solid"
                  data-cove-label-color={space.labelColor}
                  aria-hidden="true"
                />
              ) : null}
              {space.name}
            </button>

            <button
              type="button"
              className={
                isExplorerOpen
                  ? 'workspace-space-region__files-pill workspace-space-region__files-pill--active'
                  : 'workspace-space-region__files-pill'
              }
              data-testid={`workspace-space-files-${space.id}`}
              aria-pressed={isExplorerOpen}
              aria-label={t('spaceActions.openExplorer')}
              title={filesPillTitle}
              onClick={event => {
                event.stopPropagation()
                onToggleExplorer?.(space.id)
              }}
            >
              <Folder className="workspace-space-region__files-pill-icon" aria-hidden="true" />
              <span className="workspace-space-region__files-pill-label">
                {t('spaceActions.files')}
              </span>
              {filesPillCount !== null && filesPillCount > 0 ? (
                <span className="workspace-space-region__files-pill-count" aria-hidden="true">
                  {filesPillCount > 99 ? '99+' : filesPillCount}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              className="workspace-space-region__menu"
              data-testid={`workspace-space-menu-${space.id}`}
              aria-label={t('spaceActions.openSpaceActions', { name: space.name })}
              title={t('spaceActions.title')}
              onClick={event => {
                event.stopPropagation()
                const rect = event.currentTarget.getBoundingClientRect()
                onOpenSpaceMenu?.(space.id, {
                  x: Math.round(rect.left),
                  y: Math.round(rect.bottom + 8),
                })
              }}
            >
              ...
            </button>
          </div>

          <div
            className="workspace-space-region__label-group workspace-space-region__label-group--right nodrag nowheel"
            onPointerDown={event => {
              event.stopPropagation()
            }}
            onClick={event => {
              event.stopPropagation()
            }}
          >
            {branchName && resolvedBranchBadge && worktreePath && allowBranchRename ? (
              <button
                type="button"
                className="workspace-space-region__branch-badge workspace-space-region__branch-badge--button"
                data-testid={`workspace-space-worktree-branch-${space.id}`}
                title={resolvedBranchBadge.title}
                onClick={event => {
                  event.stopPropagation()
                  onStartBranchRename({
                    spaceId: space.id,
                    spaceName: space.name,
                    worktreePath,
                    branchName,
                  })
                }}
              >
                <span className="workspace-space-region__branch-badge-kind">
                  {resolvedBranchBadge.kind}
                </span>
                <span className="workspace-space-region__branch-badge-value">
                  {resolvedBranchBadge.value}
                </span>
              </button>
            ) : resolvedBranchBadge ? (
              <span
                className="workspace-space-region__branch-badge"
                data-testid={`workspace-space-worktree-branch-${space.id}`}
                title={resolvedBranchBadge.title}
              >
                <span className="workspace-space-region__branch-badge-kind">
                  {resolvedBranchBadge.kind}
                </span>
                <span className="workspace-space-region__branch-badge-value">
                  {resolvedBranchBadge.value}
                </span>
              </span>
            ) : null}

            {branchName &&
            worktreePath &&
            shouldShowPullRequestChip &&
            resolvedPullRequestSummary ? (
              <a
                className="workspace-space-region__pr-chip"
                data-testid={`workspace-space-pr-chip-${space.id}`}
                href={pullRequestUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                title={`${resolvedPullRequestSummary.title} (#${resolvedPullRequestSummary.number})`}
                onPointerDown={event => {
                  event.stopPropagation()
                }}
                onClick={event => {
                  event.stopPropagation()
                }}
              >
                <span className="workspace-space-region__pr-chip-kind">PR</span>
                <span className="workspace-space-region__pr-chip-value">
                  {`#${resolvedPullRequestSummary.number}`}
                </span>
              </a>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
