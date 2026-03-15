import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { GitWorktreeInfo } from '@shared/contracts/dto'
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
  resolvedBranchBadge,
  onStartBranchRename,
  onOpenSpaceMenu,
}: {
  space: SpaceVisual
  resolvedRect: WorkspaceSpaceRect
  isSelected: boolean
  editingSpaceId: string | null
  spaceRenameInputRef: React.RefObject<HTMLInputElement>
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
  resolvedBranchBadge: WorkspaceSpaceBranchBadge | null
  onStartBranchRename: (payload: {
    spaceId: string
    spaceName: string
    worktreePath: string
    branchName: string
  }) => void
  onOpenSpaceMenu?: (spaceId: string, anchor: { x: number; y: number }) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={
        isSelected
          ? 'workspace-space-region workspace-space-region--selected'
          : 'workspace-space-region'
      }
      style={{
        transform: `translate(${resolvedRect.x}px, ${resolvedRect.y}px)`,
        width: resolvedRect.width,
        height: resolvedRect.height,
      }}
    >
      {isSelected ? (
        <div
          className="workspace-space-region__move-handle"
          data-testid={`workspace-space-drag-${space.id}-move`}
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
            handleSpaceDragHandlePointerDown(
              event,
              space.id,
              isSelected ? { mode: 'region' } : undefined,
            )
          }}
          onPointerMove={event => {
            updateHandleCursor(event, resolvedRect, isSelected ? 'region' : 'auto')
          }}
          onMouseDown={event => {
            handleSpaceDragHandlePointerDown(
              event,
              space.id,
              isSelected ? { mode: 'region' } : undefined,
            )
          }}
          onMouseMove={event => {
            updateHandleCursor(event, resolvedRect, isSelected ? 'region' : 'auto')
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
        <div
          className="workspace-space-region__label-group nodrag nowheel"
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
            {space.name}
          </button>

          {resolvedWorktreeInfo?.branch && resolvedBranchBadge ? (
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
                  worktreePath: resolvedWorktreeInfo.path,
                  branchName: resolvedWorktreeInfo.branch,
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
      )}
    </div>
  )
}
