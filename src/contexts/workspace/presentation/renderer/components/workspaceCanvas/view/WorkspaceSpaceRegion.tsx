import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { GitWorktreeInfo } from '@shared/contracts/dto'
import type { WorkspaceSpaceRect } from '../../../types'
import type { SpaceVisual } from '../types'
import type { BranchRenameState } from './WorkspaceSpaceBranchRenameDialog'

interface BranchBadgeState {
  kind: string
  value: string
  title: string
}

interface WorkspaceSpaceRegionProps {
  space: SpaceVisual
  resolvedRect: WorkspaceSpaceRect
  isSelected: boolean
  editingSpaceId: string | null
  spaceRenameInputRef: React.RefObject<HTMLInputElement | null>
  spaceRenameDraft: string
  setSpaceRenameDraft: React.Dispatch<React.SetStateAction<string>>
  commitSpaceRename: (spaceId: string) => void
  cancelSpaceRename: () => void
  startSpaceRename: (spaceId: string) => void
  resolvedWorktreeInfo: GitWorktreeInfo | null
  resolvedBranchBadge: BranchBadgeState | null
  handleSpaceDragHandlePointerDown: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    spaceId: string,
    options?: { mode?: 'auto' | 'region' },
  ) => void
  updateHandleCursor: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    rect: WorkspaceSpaceRect,
    mode: 'auto' | 'region',
  ) => void
  onOpenSpaceMenu?: (spaceId: string, anchor: { x: number; y: number }) => void
  setBranchRename: React.Dispatch<React.SetStateAction<BranchRenameState | null>>
}

export function WorkspaceSpaceRegion({
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
  resolvedWorktreeInfo,
  resolvedBranchBadge,
  handleSpaceDragHandlePointerDown,
  updateHandleCursor,
  onOpenSpaceMenu,
  setBranchRename,
}: WorkspaceSpaceRegionProps): React.JSX.Element {
  const { t } = useTranslation()
  const branchName = resolvedWorktreeInfo?.branch ?? null
  const worktreePath = resolvedWorktreeInfo?.path ?? null
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
      <div
        className="workspace-space-region__drag-handle workspace-space-region__drag-handle--top"
        data-testid={`workspace-space-drag-${space.id}-top`}
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
      <div
        className="workspace-space-region__drag-handle workspace-space-region__drag-handle--right"
        data-testid={`workspace-space-drag-${space.id}-right`}
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
      <div
        className="workspace-space-region__drag-handle workspace-space-region__drag-handle--bottom"
        data-testid={`workspace-space-drag-${space.id}-bottom`}
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
      <div
        className="workspace-space-region__drag-handle workspace-space-region__drag-handle--left"
        data-testid={`workspace-space-drag-${space.id}-left`}
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

          {branchName && resolvedBranchBadge && worktreePath ? (
            <button
              type="button"
              className="workspace-space-region__branch-badge workspace-space-region__branch-badge--button"
              data-testid={`workspace-space-worktree-branch-${space.id}`}
              title={resolvedBranchBadge.title}
              onClick={event => {
                event.stopPropagation()
                setBranchRename({
                  spaceId: space.id,
                  spaceName: space.name,
                  worktreePath,
                  currentName: branchName,
                  nextName: branchName,
                  isSubmitting: false,
                  error: null,
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
