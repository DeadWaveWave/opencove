import React from 'react'
import { ViewportPortal, useReactFlow } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { GitHubPullRequestSummary, GitWorktreeInfo } from '@shared/contracts/dto'
import type { WorkspaceSpaceRect } from '../../../types'
import type { SpaceVisual } from '../types'
import { toErrorMessage } from '../helpers'
import { getBranchNameValidationError, getWorktreeApiMethod } from '../windows/spaceWorktree.shared'
import {
  getSpaceFrameHandleCursor,
  resolveInteractiveSpaceFrameHandle,
  type SpaceFrameHandleMode,
} from '../../../utils/spaceLayout'
import {
  WorkspaceSpaceBranchRenameDialog,
  type BranchRenameState,
} from './WorkspaceSpaceBranchRenameDialog'
import {
  WorkspaceSpaceRegionItem,
  type WorkspaceSpaceBranchBadge,
} from './WorkspaceSpaceRegionItem'

const PULL_REQUEST_REFRESH_INTERVAL_MS = 60_000

interface WorkspaceSpaceRegionsOverlayProps {
  workspacePath: string
  spaceVisuals: SpaceVisual[]
  spaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null
  selectedSpaceIds: string[]
  handleSpaceDragHandlePointerDown: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    spaceId: string,
    options?: { mode?: 'auto' | 'region' },
  ) => void
  editingSpaceId: string | null
  spaceRenameInputRef: React.RefObject<HTMLInputElement | null>
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
  const { t } = useTranslation()
  const reactFlow = useReactFlow()
  const selectedSpaceIdSet = React.useMemo(() => new Set(selectedSpaceIds), [selectedSpaceIds])
  const branchRenameInputRef = React.useRef<HTMLInputElement | null>(null)
  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const [branchRename, setBranchRename] = React.useState<BranchRenameState | null>(null)
  const [pullRequestsByBranch, setPullRequestsByBranch] = React.useState<
    Record<string, GitHubPullRequestSummary | null>
  >(() => ({}))

  const normalizedWorkspacePath = React.useMemo(
    () => normalizeComparablePath(workspacePath),
    [workspacePath],
  )

  const githubPullRequestsEnabled = useAppStore(
    state => state.agentSettings.githubPullRequestsEnabled,
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

  const worktreeBranches = React.useMemo(() => {
    const unique = new Set<string>()

    spaceVisuals.forEach(space => {
      const directoryPath = normalizeComparablePath(space.directoryPath)
      const hasWorktreeDirectory =
        directoryPath.length > 0 && directoryPath !== normalizedWorkspacePath
      if (!hasWorktreeDirectory) {
        return
      }

      const info = worktreeInfoByPath.get(directoryPath)
      const branch = info?.branch?.trim() ?? ''
      if (branch.length > 0) {
        unique.add(branch)
      }
    })

    return [...unique].sort((left, right) => left.localeCompare(right))
  }, [normalizedWorkspacePath, spaceVisuals, worktreeInfoByPath])

  const worktreeBranchesKey = React.useMemo(() => worktreeBranches.join('|'), [worktreeBranches])

  React.useEffect(() => {
    if (worktreeDirectories.length === 0) {
      setWorktreeInfoByPath(new Map())
      return
    }

    const listWorktrees = window.opencoveApi?.worktree?.listWorktrees
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
    if (worktreeBranches.length === 0) {
      setPullRequestsByBranch({})
      return
    }

    if (!githubPullRequestsEnabled) {
      setPullRequestsByBranch({})
      return
    }

    const resolvePullRequests = window.opencoveApi?.integration?.github?.resolvePullRequests
    if (typeof resolvePullRequests !== 'function') {
      setPullRequestsByBranch(Object.fromEntries(worktreeBranches.map(branch => [branch, null])))
      return
    }

    let cancelled = false
    let intervalId: number | null = null

    const resolveAll = async (): Promise<void> => {
      try {
        const result = await resolvePullRequests({
          repoPath: workspacePath,
          branches: worktreeBranches,
        })

        if (cancelled) {
          return
        }

        setPullRequestsByBranch(result.pullRequestsByBranch)
      } catch {
        if (cancelled) {
          return
        }

        setPullRequestsByBranch(previous => {
          const next: Record<string, GitHubPullRequestSummary | null> = {}
          worktreeBranches.forEach(branch => {
            next[branch] = previous[branch] ?? null
          })
          return next
        })
      }
    }

    void resolveAll()
    intervalId = window.setInterval(() => {
      void resolveAll()
    }, PULL_REQUEST_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
    }
  }, [githubPullRequestsEnabled, worktreeBranches, worktreeBranchesKey, workspacePath])

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
    const validationError = getBranchNameValidationError(nextName, t)
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
              error: t('branchRenameDialog.unchanged'),
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
      const renameBranch = getWorktreeApiMethod('renameBranch', t)
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
  }, [branchRename, t, workspacePath])

  const updateHandleCursor = React.useCallback(
    (
      event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
      rect: WorkspaceSpaceRect,
      mode: SpaceFrameHandleMode,
    ): void => {
      const point = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      const handle = resolveInteractiveSpaceFrameHandle({
        rect,
        point,
        zoom: reactFlow.getZoom(),
        mode,
      })
      event.currentTarget.style.cursor = getSpaceFrameHandleCursor(handle)
    },
    [reactFlow],
  )

  return (
    <>
      <ViewportPortal>
        {spaceVisuals.map(space => {
          const normalizedDirectoryPath = normalizeComparablePath(space.directoryPath)
          const hasWorktreeDirectory =
            normalizedDirectoryPath.length > 0 &&
            normalizedDirectoryPath !== normalizedWorkspacePath
          const resolvedRect = spaceFramePreview?.get(space.id) ?? space.rect
          const resolvedWorktreeInfo = hasWorktreeDirectory
            ? (worktreeInfoByPath.get(normalizedDirectoryPath) ?? null)
            : null
          const isSelected = selectedSpaceIdSet.has(space.id)

          const resolvedBranchBadge: WorkspaceSpaceBranchBadge | null = resolvedWorktreeInfo
            ? resolvedWorktreeInfo.branch
              ? {
                  kind: t('worktree.branch'),
                  value: resolvedWorktreeInfo.branch,
                  title: resolvedWorktreeInfo.branch,
                }
              : resolvedWorktreeInfo.head
                ? {
                    kind: t('worktree.detached'),
                    value: toShortSha(resolvedWorktreeInfo.head),
                    title: resolvedWorktreeInfo.head,
                  }
                : null
            : null

          const branchKey = resolvedWorktreeInfo?.branch?.trim() ?? ''
          const resolvedPullRequestSummary =
            branchKey.length > 0 ? (pullRequestsByBranch[branchKey] ?? null) : null

          return (
            <WorkspaceSpaceRegionItem
              key={space.id}
              space={space}
              resolvedRect={resolvedRect}
              isSelected={isSelected}
              githubPullRequestsEnabled={githubPullRequestsEnabled}
              editingSpaceId={editingSpaceId}
              spaceRenameInputRef={spaceRenameInputRef}
              spaceRenameDraft={spaceRenameDraft}
              setSpaceRenameDraft={setSpaceRenameDraft}
              commitSpaceRename={commitSpaceRename}
              cancelSpaceRename={cancelSpaceRename}
              startSpaceRename={startSpaceRename}
              handleSpaceDragHandlePointerDown={handleSpaceDragHandlePointerDown}
              updateHandleCursor={updateHandleCursor}
              resolvedWorktreeInfo={resolvedWorktreeInfo}
              resolvedBranchBadge={resolvedBranchBadge}
              resolvedPullRequestSummary={resolvedPullRequestSummary}
              onStartBranchRename={({ spaceId, spaceName, worktreePath, branchName }) => {
                setBranchRename({
                  spaceId,
                  spaceName,
                  worktreePath,
                  currentName: branchName,
                  nextName: branchName,
                  isSubmitting: false,
                  error: null,
                })
              }}
              onOpenSpaceMenu={onOpenSpaceMenu}
            />
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
