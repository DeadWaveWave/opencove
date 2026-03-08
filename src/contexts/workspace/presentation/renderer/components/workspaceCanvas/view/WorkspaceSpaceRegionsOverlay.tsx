import React from 'react'
import { ViewportPortal } from '@xyflow/react'
import type { GitWorktreeInfo } from '@shared/contracts/dto'
import type { WorkspaceSpaceRect } from '../../../types'
import type { SpaceVisual } from '../types'
import { toErrorMessage } from '../helpers'
import { getBranchNameValidationError, getWorktreeApiMethod } from '../windows/spaceWorktree.shared'
import {
  WorkspaceSpaceBranchRenameDialog,
  type BranchRenameState,
} from './WorkspaceSpaceBranchRenameDialog'

interface WorkspaceSpaceRegionsOverlayProps {
  workspacePath: string
  spaceVisuals: SpaceVisual[]
  spaceFramePreview: { spaceId: string; rect: WorkspaceSpaceRect } | null
  selectedSpaceIds: string[]
  handleSpaceDragHandlePointerDown: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    spaceId: string,
    options?: { mode?: 'auto' | 'region' },
  ) => void
  editingSpaceId: string | null
  spaceRenameInputRef: React.RefObject<HTMLInputElement>
  spaceRenameDraft: string
  setSpaceRenameDraft: React.Dispatch<React.SetStateAction<string>>
  commitSpaceRename: (spaceId: string) => void
  cancelSpaceRename: () => void
  startSpaceRename: (spaceId: string) => void
  onOpenSpaceMenu?: (spaceId: string, anchor: { x: number; y: number }) => void
}

export function WorkspaceSpaceRegionsOverlay({
  workspacePath,
  spaceVisuals,
  spaceFramePreview,
  selectedSpaceIds,
  handleSpaceDragHandlePointerDown,
  editingSpaceId,
  spaceRenameInputRef,
  spaceRenameDraft,
  setSpaceRenameDraft,
  commitSpaceRename,
  cancelSpaceRename,
  startSpaceRename,
  onOpenSpaceMenu,
}: WorkspaceSpaceRegionsOverlayProps): React.JSX.Element {
  const selectedSpaceIdSet = React.useMemo(() => new Set(selectedSpaceIds), [selectedSpaceIds])
  const branchRenameInputRef = React.useRef<HTMLInputElement | null>(null)
  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const [branchRename, setBranchRename] = React.useState<BranchRenameState | null>(null)

  const normalizedWorkspacePath = React.useMemo(
    () => normalizeComparablePath(workspacePath),
    [workspacePath],
  )

  const worktreeDirectories = React.useMemo(() => {
    const unique = new Set<string>()

    spaceVisuals.forEach(space => {
      const directoryPath = normalizeComparablePath(space.directoryPath)
      if (directoryPath.length === 0 || directoryPath === normalizedWorkspacePath) {
        return
      }

      unique.add(directoryPath)
    })

    return [...unique].sort((left, right) => left.localeCompare(right))
  }, [normalizedWorkspacePath, spaceVisuals])

  const worktreeDirectoriesKey = React.useMemo(
    () => worktreeDirectories.join('|'),
    [worktreeDirectories],
  )

  const [worktreeInfoByPath, setWorktreeInfoByPath] = React.useState<Map<string, GitWorktreeInfo>>(
    () => new Map(),
  )

  React.useEffect(() => {
    if (worktreeDirectories.length === 0) {
      setWorktreeInfoByPath(new Map())
      return
    }

    const listWorktrees = window.coveApi?.worktree?.listWorktrees
    if (typeof listWorktrees !== 'function') {
      setWorktreeInfoByPath(new Map())
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const result = await listWorktrees({ repoPath: workspacePath })
        if (cancelled) {
          return
        }

        const nextMap = new Map<string, GitWorktreeInfo>()
        result.worktrees.forEach(entry => {
          nextMap.set(normalizeComparablePath(entry.path), entry)
        })

        setWorktreeInfoByPath(nextMap)
      } catch {
        if (cancelled) {
          return
        }

        setWorktreeInfoByPath(new Map())
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refreshNonce, worktreeDirectories.length, worktreeDirectoriesKey, workspacePath])

  React.useEffect(() => {
    if (!branchRename?.spaceId) {
      return
    }

    branchRenameInputRef.current?.focus()
    branchRenameInputRef.current?.select()
  }, [branchRename?.spaceId])

  React.useEffect(() => {
    if (!branchRename?.spaceId) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !branchRename.isSubmitting) {
        event.preventDefault()
        setBranchRename(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [branchRename?.isSubmitting, branchRename?.spaceId])

  const closeBranchRename = React.useCallback(() => {
    setBranchRename(previous => (previous?.isSubmitting ? previous : null))
  }, [])

  const submitBranchRename = React.useCallback(async () => {
    if (!branchRename) {
      return
    }

    const nextName = branchRename.nextName.trim()
    const validationError = getBranchNameValidationError(nextName)
    if (validationError) {
      setBranchRename(previous =>
        previous
          ? {
              ...previous,
              error: validationError,
            }
          : previous,
      )
      return
    }

    if (nextName === branchRename.currentName) {
      setBranchRename(previous =>
        previous
          ? {
              ...previous,
              error: 'Branch name is unchanged.',
            }
          : previous,
      )
      return
    }

    setBranchRename(previous =>
      previous
        ? {
            ...previous,
            nextName,
            isSubmitting: true,
            error: null,
          }
        : previous,
    )

    try {
      const renameBranch = getWorktreeApiMethod('renameBranch')
      await renameBranch({
        repoPath: workspacePath,
        worktreePath: branchRename.worktreePath,
        currentName: branchRename.currentName,
        nextName,
      })

      setBranchRename(null)
      setRefreshNonce(previous => previous + 1)
    } catch (renameError) {
      setBranchRename(previous =>
        previous
          ? {
              ...previous,
              isSubmitting: false,
              error: toErrorMessage(renameError),
            }
          : previous,
      )
    }
  }, [branchRename, workspacePath])

  return (
    <>
      <ViewportPortal>
        {spaceVisuals.map(space => {
          const normalizedDirectoryPath = normalizeComparablePath(space.directoryPath)
          const hasWorktreeDirectory =
            normalizedDirectoryPath.length > 0 &&
            normalizedDirectoryPath !== normalizedWorkspacePath
          const resolvedRect =
            spaceFramePreview?.spaceId === space.id ? spaceFramePreview.rect : space.rect
          const resolvedWorktreeInfo = hasWorktreeDirectory
            ? (worktreeInfoByPath.get(normalizedDirectoryPath) ?? null)
            : null
          const isSelected = selectedSpaceIdSet.has(space.id)

          const resolvedBranchBadge = resolvedWorktreeInfo
            ? resolvedWorktreeInfo.branch
              ? {
                  kind: 'Branch',
                  value: resolvedWorktreeInfo.branch,
                  title: resolvedWorktreeInfo.branch,
                }
              : resolvedWorktreeInfo.head
                ? {
                    kind: 'Detached',
                    value: toShortSha(resolvedWorktreeInfo.head),
                    title: resolvedWorktreeInfo.head,
                  }
                : null
            : null

          return (
            <div
              key={space.id}
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
                  onMouseDown={event => {
                    handleSpaceDragHandlePointerDown(event, space.id, { mode: 'region' })
                  }}
                />
              ) : null}
              <div
                className="workspace-space-region__drag-handle workspace-space-region__drag-handle--top"
                data-testid={`workspace-space-drag-${space.id}-top`}
                onPointerDown={event => {
                  handleSpaceDragHandlePointerDown(
                    event,
                    space.id,
                    isSelected ? { mode: 'region' } : undefined,
                  )
                }}
                onMouseDown={event => {
                  handleSpaceDragHandlePointerDown(
                    event,
                    space.id,
                    isSelected ? { mode: 'region' } : undefined,
                  )
                }}
              />
              <div
                className="workspace-space-region__drag-handle workspace-space-region__drag-handle--right"
                data-testid={`workspace-space-drag-${space.id}-right`}
                onPointerDown={event => {
                  handleSpaceDragHandlePointerDown(
                    event,
                    space.id,
                    isSelected ? { mode: 'region' } : undefined,
                  )
                }}
                onMouseDown={event => {
                  handleSpaceDragHandlePointerDown(
                    event,
                    space.id,
                    isSelected ? { mode: 'region' } : undefined,
                  )
                }}
              />
              <div
                className="workspace-space-region__drag-handle workspace-space-region__drag-handle--bottom"
                data-testid={`workspace-space-drag-${space.id}-bottom`}
                onPointerDown={event => {
                  handleSpaceDragHandlePointerDown(
                    event,
                    space.id,
                    isSelected ? { mode: 'region' } : undefined,
                  )
                }}
                onMouseDown={event => {
                  handleSpaceDragHandlePointerDown(
                    event,
                    space.id,
                    isSelected ? { mode: 'region' } : undefined,
                  )
                }}
              />
              <div
                className="workspace-space-region__drag-handle workspace-space-region__drag-handle--left"
                data-testid={`workspace-space-drag-${space.id}-left`}
                onPointerDown={event => {
                  handleSpaceDragHandlePointerDown(
                    event,
                    space.id,
                    isSelected ? { mode: 'region' } : undefined,
                  )
                }}
                onMouseDown={event => {
                  handleSpaceDragHandlePointerDown(
                    event,
                    space.id,
                    isSelected ? { mode: 'region' } : undefined,
                  )
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

                  {resolvedWorktreeInfo?.branch && resolvedBranchBadge ? (
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
                          worktreePath: resolvedWorktreeInfo.path,
                          currentName: resolvedWorktreeInfo.branch,
                          nextName: resolvedWorktreeInfo.branch,
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
                    aria-label={`Open ${space.name} space actions`}
                    title="Space Actions"
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
        })}
      </ViewportPortal>

      <WorkspaceSpaceBranchRenameDialog
        branchRename={branchRename}
        branchRenameInputRef={branchRenameInputRef}
        setBranchRename={setBranchRename}
        closeBranchRename={closeBranchRename}
        submitBranchRename={submitBranchRename}
      />
    </>
  )
}

function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/[\\/]+$/, '')
}

function toShortSha(value: string): string {
  return value.trim().slice(0, 7)
}
