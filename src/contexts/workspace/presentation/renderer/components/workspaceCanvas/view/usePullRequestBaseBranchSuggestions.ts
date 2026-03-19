import React from 'react'
import type { WorkspaceSpacePullRequestPanelState } from './WorkspaceSpacePullRequestPanel'

export function usePullRequestBaseBranchSuggestions({
  panel,
  repoPath,
  pullRequestBaseBranchOptions,
  setCreateBase,
}: {
  panel: WorkspaceSpacePullRequestPanelState | null
  repoPath: string
  pullRequestBaseBranchOptions: string[]
  setCreateBase: React.Dispatch<React.SetStateAction<string>>
}): string[] {
  const [defaultBaseBranch, setDefaultBaseBranch] = React.useState<string | null>(null)
  const defaultBranchCacheRef = React.useRef(new Map<string, string | null>())
  const defaultBranchRequestIdRef = React.useRef(0)

  React.useEffect(() => {
    if (!panel) {
      return
    }

    const cached = defaultBranchCacheRef.current.get(repoPath)
    if (cached !== undefined) {
      setDefaultBaseBranch(cached)
      if (cached) {
        setCreateBase(previous => (previous.trim().length === 0 ? cached : previous))
      }
      return
    }

    const getDefaultBranch = window.opencoveApi?.worktree?.getDefaultBranch
    if (typeof getDefaultBranch !== 'function') {
      defaultBranchCacheRef.current.set(repoPath, null)
      setDefaultBaseBranch(null)
      return
    }

    const requestId = ++defaultBranchRequestIdRef.current

    void (async () => {
      try {
        const result = await getDefaultBranch({ repoPath })
        if (defaultBranchRequestIdRef.current !== requestId) {
          return
        }

        const branch = result.branch?.trim() || null
        defaultBranchCacheRef.current.set(repoPath, branch)
        setDefaultBaseBranch(branch)

        if (branch) {
          setCreateBase(previous => (previous.trim().length === 0 ? branch : previous))
        }
      } catch {
        if (defaultBranchRequestIdRef.current !== requestId) {
          return
        }

        defaultBranchCacheRef.current.set(repoPath, null)
        setDefaultBaseBranch(null)
      }
    })()
  }, [panel, repoPath, setCreateBase])

  return React.useMemo(() => {
    const candidates = [
      defaultBaseBranch,
      ...pullRequestBaseBranchOptions.map(option => option.trim()).filter(Boolean),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

    return [...new Set(candidates)]
  }, [defaultBaseBranch, pullRequestBaseBranchOptions])
}
