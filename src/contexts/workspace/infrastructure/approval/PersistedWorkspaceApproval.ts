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
    if (rootPath && !seen.has(rootPath)) {
      seen.add(rootPath)
      roots.push(rootPath)
    }

    for (const space of workspace.spaces) {
      const directoryPath = normalizeRootPath(space.directoryPath)
      if (!directoryPath || seen.has(directoryPath)) {
        continue
      }

      seen.add(directoryPath)
      roots.push(directoryPath)
    }
  }

  return roots
}

const HYDRATION_RETRY_BACKOFF_MS = 250

function normalizeRoots(values: string[]): string[] {
  const seen = new Set<string>()
  const uniqueRoots: string[] = []
  for (const rootPath of values) {
    const normalizedRoot = normalizeRootPath(rootPath)
    if (!normalizedRoot || seen.has(normalizedRoot)) {
      continue
    }

    seen.add(normalizedRoot)
    uniqueRoots.push(normalizedRoot)
  }

  return uniqueRoots
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
  const extraRoots = normalizeRoots(Array.isArray(options.extraRoots) ? options.extraRoots : [])

  let extraRootsRegistered = false
  let hydrated = false
  let hydrationAttempt: Promise<void> | null = null
  let lastFailureAt: number | null = null

  async function registerExtraRoots(): Promise<void> {
    if (extraRootsRegistered) {
      return
    }

    extraRootsRegistered = true
    await Promise.all(
      extraRoots.map(async rootPath => {
        await options.approvedWorkspaces.registerRoot(rootPath)
      }),
    )
  }

  async function hydrate(): Promise<void> {
    // Extra roots (for example the test workspace) do not depend on
    // persistence, so register them even when the read below fails.
    await registerExtraRoots()

    const appState = await options.readAppState()
    const persistedRoots = normalizeRoots(listPersistedWorkspaceApprovalRoots(appState))

    await Promise.all(
      persistedRoots.map(async rootPath => {
        await options.approvedWorkspaces.registerRoot(rootPath)
      }),
    )
  }

  function ensureHydrated(): Promise<void> {
    if (hydrated) {
      return Promise.resolve()
    }

    if (hydrationAttempt) {
      return hydrationAttempt
    }

    hydrationAttempt = (async () => {
      try {
        // After a failed read, wait a short backoff before reading again so a
        // burst of approval checks cannot hammer a still-starting Worker.
        if (lastFailureAt !== null) {
          const elapsedMs = Date.now() - lastFailureAt
          const waitMs = HYDRATION_RETRY_BACKOFF_MS - elapsedMs
          if (waitMs > 0) {
            await new Promise<void>(resolve => {
              setTimeout(resolve, waitMs)
            })
          }
        }

        await hydrate()
        hydrated = true
        lastFailureAt = null
      } catch (error) {
        lastFailureAt = Date.now()
        options.onError?.(error)
      } finally {
        hydrationAttempt = null
      }
    })()

    return hydrationAttempt
  }

  const ready = ensureHydrated()

  return {
    ready,
    approvedWorkspaces: {
      registerRoot: async rootPath => {
        await ensureHydrated()
        await options.approvedWorkspaces.registerRoot(rootPath)
      },
      isPathApproved: async targetPath => {
        await ensureHydrated()
        return await options.approvedWorkspaces.isPathApproved(targetPath)
      },
    },
  }
}
