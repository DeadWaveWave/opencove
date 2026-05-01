import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import { applyUiLanguage, translate } from '@app/renderer/i18n'
import type {
  PersistedWorkspaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { useScrollbackStore } from '@contexts/workspace/presentation/renderer/store/useScrollbackStore'
import { readPersistedStateWithMeta } from '@contexts/workspace/presentation/renderer/utils/persistence'
import { getPersistencePort } from '@contexts/workspace/presentation/renderer/utils/persistence/port'
import { resolveCanvasCanonicalBucketFromViewport } from '@contexts/workspace/presentation/renderer/utils/workspaceNodeSizing'
import { useAppStore } from '../store/useAppStore'
import {
  mergeHydratedNode,
  prepareWorkspaceRuntimeNodes,
  toShellWorkspaceState,
} from './useHydrateAppState.helpers'

export { hydrateRuntimeNode, resolveTerminalHydrationCwd } from './useHydrateAppState.helpers'

async function inferInitialStandardWindowSizeBucket(): Promise<StandardWindowSizeBucket> {
  const getter = window.opencoveApi?.windowMetrics?.getDisplayInfo
  if (typeof getter !== 'function') {
    return DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket
  }

  try {
    return resolveCanvasCanonicalBucketFromViewport(undefined, await getter())
  } catch {
    return DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => {
    window.setTimeout(resolve, ms)
  })
}

export function useHydrateAppState({
  activeWorkspaceId,
  setAgentSettings,
  setWorkspaces,
  setActiveWorkspaceId,
}: {
  activeWorkspaceId: string | null
  setAgentSettings: React.Dispatch<React.SetStateAction<AgentSettings>>
  setWorkspaces: React.Dispatch<React.SetStateAction<WorkspaceState[]>>
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>
}): { isHydrated: boolean; isPersistReady: boolean } {
  const [isHydrated, setIsHydrated] = useState(false)
  const [isPersistReady, setIsPersistReady] = useState(false)
  const isCancelledRef = useRef(false)
  const persistedWorkspaceByIdRef = useRef<Map<string, PersistedWorkspaceState>>(new Map())
  const hydratedWorkspaceIdsRef = useRef<Set<string>>(new Set())
  const hydratingWorkspacePromisesRef = useRef<Map<string, Promise<void>>>(new Map())
  const scrollbackLoadedWorkspaceIdsRef = useRef<Set<string>>(new Set())
  const loadingWorkspaceScrollbackPromisesRef = useRef<Map<string, Promise<void>>>(new Map())
  const initialHydrationWorkspaceIdRef = useRef<string | null>(null)
  const initialHydrationCompletedRef = useRef(false)

  const markInitialHydrationComplete = useCallback((workspaceId: string | null): void => {
    if (initialHydrationCompletedRef.current) {
      return
    }

    if (initialHydrationWorkspaceIdRef.current !== workspaceId) {
      return
    }

    if (isCancelledRef.current) {
      return
    }

    initialHydrationCompletedRef.current = true
    setIsHydrated(true)
  }, [])

  const readWorkspaceScrollbacks = useCallback(async (workspace: PersistedWorkspaceState) => {
    const port = getPersistencePort()
    if (!port) {
      return null
    }

    const terminalNodeIds = workspace.nodes
      .filter(node => node.kind === 'terminal')
      .map(node => node.id)

    if (terminalNodeIds.length === 0) {
      return {}
    }

    const terminalScrollbackResults = await Promise.allSettled(
      terminalNodeIds.map(nodeId => port.readNodeScrollback(nodeId)),
    )

    if (isCancelledRef.current) {
      return null
    }

    if (terminalScrollbackResults.some(result => result.status === 'rejected')) {
      return null
    }

    const scrollbacks: Record<string, string> = {}
    terminalScrollbackResults.forEach((result, index) => {
      if (result.status !== 'fulfilled' || !result.value) {
        return
      }

      scrollbacks[terminalNodeIds[index] as string] = result.value
    })

    return scrollbacks
  }, [])

  const mergeWorkspaceScrollbacks = useCallback(
    (workspaceId: string, scrollbacks: Record<string, string>): void => {
      if (Object.keys(scrollbacks).length === 0 || isCancelledRef.current) {
        return
      }

      startTransition(() => {
        setWorkspaces(previous => {
          const scrollbackByNodeId = useScrollbackStore.getState().scrollbackByNodeId
          let didChange = false

          const nextWorkspaces = previous.map(workspace => {
            if (workspace.id !== workspaceId) {
              return workspace
            }

            let workspaceDidChange = false
            const nextNodes = workspace.nodes.map(node => {
              if (node.data.kind !== 'terminal') {
                return node
              }

              const nextScrollback = scrollbacks[node.id]
              if (!nextScrollback) {
                return node
              }

              const sessionId =
                typeof node.data.sessionId === 'string' ? node.data.sessionId.trim() : ''
              if (sessionId.length > 0) {
                return node
              }

              if (typeof scrollbackByNodeId[node.id] === 'string') {
                return node
              }

              const existingScrollback =
                typeof node.data.scrollback === 'string' ? node.data.scrollback : ''
              if (existingScrollback.length > 0) {
                return node
              }

              workspaceDidChange = true
              return {
                ...node,
                data: {
                  ...node.data,
                  scrollback: nextScrollback,
                },
              }
            })

            if (!workspaceDidChange) {
              return workspace
            }

            didChange = true
            return {
              ...workspace,
              nodes: nextNodes,
            }
          })

          return didChange ? nextWorkspaces : previous
        })
      })
    },
    [setWorkspaces],
  )

  const ensureWorkspaceScrollbacksLoaded = useCallback(
    async (
      workspaceId: string,
      persistedWorkspace: PersistedWorkspaceState,
      options?: { maxAttempts?: number },
    ): Promise<void> => {
      if (scrollbackLoadedWorkspaceIdsRef.current.has(workspaceId)) {
        return
      }

      const existingPromise = loadingWorkspaceScrollbackPromisesRef.current.get(workspaceId)
      if (existingPromise) {
        await existingPromise
        return
      }

      const maxAttempts = Math.max(1, Math.floor(options?.maxAttempts ?? 1))
      const loadPromise = (async (): Promise<void> => {
        for (let attempt = 0; attempt < maxAttempts && !isCancelledRef.current; attempt += 1) {
          // eslint-disable-next-line no-await-in-loop -- bounded retries keep startup fallback local
          const scrollbacks = await readWorkspaceScrollbacks(persistedWorkspace)
          if (scrollbacks !== null) {
            mergeWorkspaceScrollbacks(workspaceId, scrollbacks)
            scrollbackLoadedWorkspaceIdsRef.current.add(workspaceId)
            return
          }

          if (attempt < maxAttempts - 1) {
            // eslint-disable-next-line no-await-in-loop -- bounded retries keep startup fallback local
            await delay(80)
          }
        }
      })().finally(() => {
        loadingWorkspaceScrollbackPromisesRef.current.delete(workspaceId)
      })

      loadingWorkspaceScrollbackPromisesRef.current.set(workspaceId, loadPromise)
      await loadPromise
    },
    [mergeWorkspaceScrollbacks, readWorkspaceScrollbacks],
  )

  const hydrateWorkspaceRuntimeNodes = useCallback(
    async (workspaceId: string, persistedWorkspace: PersistedWorkspaceState): Promise<void> => {
      if (isCancelledRef.current) {
        return
      }

      const { agentSettings } = useAppStore.getState()
      const hydratedNodes = await prepareWorkspaceRuntimeNodes({
        workspace: persistedWorkspace,
        agentSettings,
      })

      if (isCancelledRef.current || hydratedNodes.length === 0) {
        return
      }

      const hydratedById = new Map(hydratedNodes.map(node => [node.id, node]))
      setWorkspaces(previous =>
        previous.map(workspace => {
          if (workspace.id !== workspaceId) {
            return workspace
          }

          return {
            ...workspace,
            nodes: workspace.nodes.map(node => {
              const hydratedNode = hydratedById.get(node.id)
              return hydratedNode ? mergeHydratedNode(node, hydratedNode) : node
            }),
          }
        }),
      )
    },
    [setWorkspaces],
  )

  const ensureWorkspaceHydrated = useCallback(
    async (workspaceId: string | null): Promise<void> => {
      if (!workspaceId) {
        markInitialHydrationComplete(null)
        return
      }

      const persistedWorkspace = persistedWorkspaceByIdRef.current.get(workspaceId)
      if (!persistedWorkspace) {
        markInitialHydrationComplete(workspaceId)
        return
      }

      void ensureWorkspaceScrollbacksLoaded(workspaceId, persistedWorkspace)

      if (hydratedWorkspaceIdsRef.current.has(workspaceId)) {
        markInitialHydrationComplete(workspaceId)
        return
      }

      const existingPromise = hydratingWorkspacePromisesRef.current.get(workspaceId)
      if (existingPromise) {
        await existingPromise
        markInitialHydrationComplete(workspaceId)
        return
      }
      const runtimeNodeCount = persistedWorkspace.nodes.filter(
        node => node.kind === 'terminal' || node.kind === 'agent',
      ).length
      if (runtimeNodeCount === 0) {
        hydratedWorkspaceIdsRef.current.add(workspaceId)
        markInitialHydrationComplete(workspaceId)
        return
      }

      const hydrationPromise = hydrateWorkspaceRuntimeNodes(workspaceId, persistedWorkspace)
        .then(() => {
          hydratedWorkspaceIdsRef.current.add(workspaceId)
        })
        .finally(() => {
          hydratingWorkspacePromisesRef.current.delete(workspaceId)
          markInitialHydrationComplete(workspaceId)
        })

      hydratingWorkspacePromisesRef.current.set(workspaceId, hydrationPromise)
      await hydrationPromise
    },
    [ensureWorkspaceScrollbacksLoaded, hydrateWorkspaceRuntimeNodes, markInitialHydrationComplete],
  )

  useEffect(() => {
    isCancelledRef.current = false
    initialHydrationCompletedRef.current = false
    initialHydrationWorkspaceIdRef.current = null
    persistedWorkspaceByIdRef.current = new Map()
    hydratedWorkspaceIdsRef.current = new Set()
    hydratingWorkspacePromisesRef.current = new Map()
    scrollbackLoadedWorkspaceIdsRef.current = new Set()
    loadingWorkspaceScrollbackPromisesRef.current = new Map()
    useScrollbackStore.getState().clearAllScrollbacks()
    setIsHydrated(false)
    setIsPersistReady(false)

    const hydrateAppState = async (): Promise<void> => {
      const {
        state: persisted,
        recovery,
        hasStandardWindowSizeBucket,
      } = await readPersistedStateWithMeta()
      if (isCancelledRef.current) {
        return
      }

      let resolvedSettings = persisted?.settings ?? DEFAULT_AGENT_SETTINGS
      if (!hasStandardWindowSizeBucket) {
        resolvedSettings = {
          ...resolvedSettings,
          standardWindowSizeBucket: await inferInitialStandardWindowSizeBucket(),
        }
      }

      if (isCancelledRef.current) {
        return
      }

      if (persisted) {
        await applyUiLanguage(resolvedSettings.language)
      }

      if (recovery) {
        const recoveryMessage =
          recovery === 'corrupt_db'
            ? translate('persistence.recoveryCorruptDb')
            : translate('persistence.recoveryMigrationFailed')
        useAppStore
          .getState()
          .setPersistNotice({ tone: 'warning', message: recoveryMessage, kind: 'recovery' })
      }

      if (!persisted) {
        setAgentSettings(resolvedSettings)
        setIsHydrated(true)
        setIsPersistReady(true)
        return
      }

      setAgentSettings(resolvedSettings)

      if (persisted.workspaces.length === 0) {
        setIsHydrated(true)
        setIsPersistReady(true)
        return
      }

      const hasActiveWorkspace = persisted.workspaces.some(
        workspace => workspace.id === persisted.activeWorkspaceId,
      )
      const resolvedActiveWorkspaceId = hasActiveWorkspace
        ? persisted.activeWorkspaceId
        : (persisted.workspaces[0]?.id ?? null)

      persistedWorkspaceByIdRef.current = new Map(
        persisted.workspaces.map(workspace => [workspace.id, workspace]),
      )
      initialHydrationWorkspaceIdRef.current = resolvedActiveWorkspaceId

      const initialWorkspaces = persisted.workspaces.map(workspace =>
        toShellWorkspaceState(workspace, { dropRuntimeSessionIds: true }),
      )

      setWorkspaces(initialWorkspaces)
      setActiveWorkspaceId(resolvedActiveWorkspaceId)
      setIsPersistReady(true)

      if (resolvedActiveWorkspaceId) {
        const activePersistedWorkspace =
          persistedWorkspaceByIdRef.current.get(resolvedActiveWorkspaceId) ?? null
        if (activePersistedWorkspace) {
          const maxScrollbackLoadAttempts = window.opencoveApi?.meta?.runtime === 'electron' ? 2 : 1
          void ensureWorkspaceScrollbacksLoaded(
            resolvedActiveWorkspaceId,
            activePersistedWorkspace,
            {
              maxAttempts: maxScrollbackLoadAttempts,
            },
          )
        }
      }

      if (!resolvedActiveWorkspaceId) {
        setIsHydrated(true)
        return
      }

      if (hydratedWorkspaceIdsRef.current.has(resolvedActiveWorkspaceId)) {
        markInitialHydrationComplete(resolvedActiveWorkspaceId)
        return
      }

      void ensureWorkspaceHydrated(resolvedActiveWorkspaceId)
    }

    void hydrateAppState()

    return () => {
      isCancelledRef.current = true
    }
  }, [
    ensureWorkspaceScrollbacksLoaded,
    ensureWorkspaceHydrated,
    markInitialHydrationComplete,
    setAgentSettings,
    setWorkspaces,
    setActiveWorkspaceId,
  ])

  useEffect(() => {
    if (!activeWorkspaceId) {
      return
    }

    if (persistedWorkspaceByIdRef.current.size === 0) {
      return
    }

    void ensureWorkspaceHydrated(activeWorkspaceId)
  }, [activeWorkspaceId, ensureWorkspaceHydrated])

  return { isHydrated, isPersistReady }
}
