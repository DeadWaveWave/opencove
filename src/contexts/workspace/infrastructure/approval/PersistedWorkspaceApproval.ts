import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { ApprovedWorkspaceStore } from './ApprovedWorkspaceStore'

function normalizeRootPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function listPersistedWorkspaceApprovalRoots(appState: unknown): string[] {
  const normalized = normalizePersistedAppState(appState)
  if (!normalized) {
    return []
  }

  const seen = new Set<string>()
  const roots: string[] = []

  for (const workspace of normalized.workspaces) {
    const rootPath = normalizeRootPath(workspace.path)
    if (!rootPath || seen.has(rootPath)) {
      continue
    }

    seen.add(rootPath)
    roots.push(rootPath)
  }

  return roots
}

export function createPersistedWorkspaceApprovalGate(options: {
  approvedWorkspaces: ApprovedWorkspaceStore
  readAppState: () => Promise<unknown | null>
  extraRoots?: string[]
  onError?: (error: unknown) => void
}): {
  approvedWorkspaces: ApprovedWorkspaceStore
  ready: Promise<void>
} {
  const ready = (async () => {
    try {
      const appState = await options.readAppState()
      const persistedRoots = listPersistedWorkspaceApprovalRoots(appState)
      const extraRoots = Array.isArray(options.extraRoots) ? options.extraRoots : []
      const roots = [...extraRoots, ...persistedRoots]

      const seen = new Set<string>()
      for (const rootPath of roots) {
        const normalizedRoot = normalizeRootPath(rootPath)
        if (!normalizedRoot || seen.has(normalizedRoot)) {
          continue
        }

        seen.add(normalizedRoot)
        await options.approvedWorkspaces.registerRoot(normalizedRoot)
      }
    } catch (error) {
      options.onError?.(error)
    }
  })()

  return {
    ready,
    approvedWorkspaces: {
      registerRoot: async rootPath => {
        await ready
        await options.approvedWorkspaces.registerRoot(rootPath)
      },
      isPathApproved: async targetPath => {
        await ready
        return await options.approvedWorkspaces.isPathApproved(targetPath)
      },
    },
  }
}
