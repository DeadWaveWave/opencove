import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { resolveGitWorktreeApiForMount } from '@contexts/worktree/presentation/renderer/windows/mountAwareGitWorktreeApi'
import { normalizeComparablePath } from '../components/workspaceCanvas/view/WorkspaceSpaceRegionsOverlay.helpers'
import {
  createWorktreeInfoStore,
  type WorktreeInfoMap,
  type WorktreeInfoSource,
} from './worktreeInfoStore'

async function listWorktreeInfo({
  repoPath,
  mountIds,
}: WorktreeInfoSource): Promise<WorktreeInfoMap> {
  const next: WorktreeInfoMap = new Map()
  if (mountIds.length > 0) {
    await Promise.all(
      mountIds.map(async mountId => {
        const listWorktrees = resolveGitWorktreeApiForMount(mountId)?.listWorktrees
        if (typeof listWorktrees !== 'function') {
          return
        }
        try {
          const result = await listWorktrees({ repoPath })
          result.worktrees.forEach(entry => next.set(normalizeComparablePath(entry.path), entry))
        } catch {
          // A mount whose root is not a git repository lists nothing.
        }
      }),
    )
    return next
  }
  const listWorktrees = window.opencoveApi?.worktree?.listWorktrees
  if (typeof listWorktrees !== 'function') {
    return next
  }
  const result = await listWorktrees({ repoPath })
  result.worktrees.forEach(entry => next.set(normalizeComparablePath(entry.path), entry))
  return next
}

/** The renderer's worktree listings, shared by the canvas and the sidebar. */
export const worktreeInfoStore = createWorktreeInfoStore({
  list: listWorktreeInfo,
  isHidden: () => typeof document !== 'undefined' && document.hidden,
})

const NONE: WorktreeInfoMap = new Map()

/**
 * A project's worktrees by comparable path, kept fresh while any component shows them.
 * `mountIdsKey` is the Spaces' mount ids joined by `|`; a new `refreshKey` lists again at once
 * (a Space's directory changed, or the caller asked).
 */
export function useWorktreeInfoByPath({
  repoPath,
  mountIdsKey,
  refreshKey = '',
}: {
  repoPath: string
  mountIdsKey: string
  refreshKey?: string
}): WorktreeInfoMap {
  const source = useMemo<WorktreeInfoSource>(
    () => ({ repoPath, mountIds: mountIdsKey.length > 0 ? mountIdsKey.split('|') : [] }),
    [mountIdsKey, repoPath],
  )
  const watched = repoPath.trim().length > 0 || source.mountIds.length > 0
  const subscribe = useCallback(
    (listener: () => void) =>
      watched ? worktreeInfoStore.subscribe(source, listener) : () => undefined,
    [source, watched],
  )
  const read = useCallback(
    () => (watched ? worktreeInfoStore.read(source) : NONE),
    [source, watched],
  )
  const worktrees = useSyncExternalStore(subscribe, read, read)
  // Subscribing lists at once; only a later change of `refreshKey` asks for another listing.
  const listedFor = useRef<{ source: WorktreeInfoSource; refreshKey: string } | null>(null)
  useEffect(() => {
    const last = listedFor.current
    listedFor.current = { source, refreshKey }
    if (watched && last?.source === source && last.refreshKey !== refreshKey) {
      worktreeInfoStore.refresh(source)
    }
  }, [refreshKey, source, watched])
  return worktrees
}
