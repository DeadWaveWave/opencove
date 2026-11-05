import type { GitWorktreeInfo } from '@shared/contracts/dto'
import { isWorktreeInfoMapEqual } from '../components/workspaceCanvas/view/WorkspaceSpaceRegionsOverlay.worktrees'

/** How often a watched repository's worktrees are listed again. */
export const WORKTREE_INFO_REFRESH_MS = 10_000

/** A repository to list: a local path, or that path inside each of the Spaces' mounts. */
export interface WorktreeInfoSource {
  repoPath: string
  mountIds: readonly string[]
}

/** Worktrees by comparable path. */
export type WorktreeInfoMap = Map<string, GitWorktreeInfo>

interface Entry {
  source: WorktreeInfoSource
  snapshot: WorktreeInfoMap
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
  listing: boolean
  again: boolean
}

export interface WorktreeInfoStore {
  /** Watches a repository: the first subscriber starts listing it, the last one stops. */
  subscribe(source: WorktreeInfoSource, listener: () => void): () => void
  /** The last listing; the same map until the worktrees change. */
  read(source: WorktreeInfoSource): WorktreeInfoMap
  /** Lists a watched repository now (after the listing in flight, if any). */
  refresh(source: WorktreeInfoSource): void
}

const EMPTY: WorktreeInfoMap = new Map()

export function worktreeInfoKey({ repoPath, mountIds }: WorktreeInfoSource): string {
  const mounts = [...new Set(mountIds.map(id => id.trim()).filter(id => id.length > 0))].sort()
  return `${repoPath.trim()}\n${mounts.join('|')}`
}

/**
 * The one owner of each repository's worktree listing in the renderer. The canvas's Space
 * frames, its Space menu and the sidebar's Space cards all read it, so a repository is listed
 * once per interval however many of them are showing; a failed listing keeps the last one.
 */
export function createWorktreeInfoStore({
  list,
  intervalMs = WORKTREE_INFO_REFRESH_MS,
  isHidden = () => false,
}: {
  list: (source: WorktreeInfoSource) => Promise<WorktreeInfoMap>
  intervalMs?: number
  /** A hidden window skips its listings; the next interval after it shows lists again. */
  isHidden?: () => boolean
}): WorktreeInfoStore {
  const entries = new Map<string, Entry>()

  const refresh = (entry: Entry): void => {
    if (entry.listing) {
      entry.again = true
      return
    }
    if (isHidden()) {
      return
    }
    entry.listing = true
    list(entry.source)
      .then(
        next => {
          if (!isWorktreeInfoMapEqual(entry.snapshot, next)) {
            entry.snapshot = next
            entry.listeners.forEach(listener => listener())
          }
        },
        () => undefined,
      )
      .finally(() => {
        entry.listing = false
        if (entry.again && entry.listeners.size > 0) {
          entry.again = false
          refresh(entry)
        }
      })
  }

  return {
    subscribe(source, listener) {
      const key = worktreeInfoKey(source)
      let entry = entries.get(key)
      if (!entry) {
        entry = {
          source,
          snapshot: EMPTY,
          listeners: new Set(),
          timer: null,
          listing: false,
          again: false,
        }
        entries.set(key, entry)
      }
      const watched = entry
      watched.listeners.add(listener)
      if (watched.listeners.size === 1) {
        refresh(watched)
        watched.timer = setInterval(() => refresh(watched), intervalMs)
      }
      return () => {
        watched.listeners.delete(listener)
        if (watched.listeners.size === 0 && watched.timer !== null) {
          clearInterval(watched.timer)
          watched.timer = null
          watched.again = false
        }
      }
    },
    read(source) {
      return entries.get(worktreeInfoKey(source))?.snapshot ?? EMPTY
    },
    refresh(source) {
      const entry = entries.get(worktreeInfoKey(source))
      if (entry && entry.listeners.size > 0) {
        refresh(entry)
      }
    },
  }
}
