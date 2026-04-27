import { useCallback, useEffect, useRef, useState } from 'react'
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

  const loadWorkspaceScrollbacks = useCallback(async (workspace: PersistedWorkspaceState) => {
    if (scrollbackLoadedWorkspaceIdsRef.current.has(workspace.id)) {
      return true
    }

    const port = getPersistencePort()
    if (!port) {
      return false
    }

    const terminalNodeIds = workspace.nodes
      .filter(node => node.kind === 'terminal')
      .map(node => node.id)

    if (terminalNodeIds.length === 0) {
      scrollbackLoadedWorkspaceIdsRef.current.add(workspace.id)
      return true
    }

    const terminalScrollbackResults = await Promise.allSettled(
      terminalNodeIds.map(nodeId => port.readNodeScrollback(nodeId)),
    )

    if (isCancelledRef.current) {
      return false
    }

    if (terminalScrollbackResults.some(result => result.status === 'rejected')) {
      return false
    }

    const scrollbacks: Record<string, string> = {}
    terminalScrollbackResults.forEach((result, index) => {
      if (result.status !== 'fulfilled' || !result.value) {
        return
      }

      scrollbacks[terminalNodeIds[index] as string] = result.value
    })
    if (Object.keys(scrollbacks).length === 0) {
      scrollbackLoadedWorkspaceIdsRef.current.add(workspace.id)
      return true
    }

    useScrollbackStore.setState(state => {
      const record = state.scrollbackByNodeId
      let didChange = false

      Object.entries(scrollbacks).forEach(([nodeId, scrollback]) => {
        if (record[nodeId]) {
          return
        }

        record[nodeId] = scrollback
        didChange = true
      })

      return didChange ? { scrollbackByNodeId: record } : state
    })

    scrollbackLoadedWorkspaceIdsRef.current.add(workspace.id)
    return true
  }, [])

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

      if (hydratedWorkspaceIdsRef.current.has(workspaceId)) {
        void loadWorkspaceScrollbacks(persistedWorkspace)
        markInitialHydrationComplete(workspaceId)
        return
      }

      const existingPromise = hydratingWorkspacePromisesRef.current.get(workspaceId)
      if (existingPromise) {
        await existingPromise
        markInitialHydrationComplete(workspaceId)
        return
      }

      void loadWorkspaceScrollbacks(persistedWorkspace)

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
    [hydrateWorkspaceRuntimeNodes, loadWorkspaceScrollbacks, markInitialHydrationComplete],
  )

  useEffect(() => {
    isCancelledRef.current = false
    initialHydrationCompletedRef.current = false
    initialHydrationWorkspaceIdRef.current = null
    persistedWorkspaceByIdRef.current = new Map()
    hydratedWorkspaceIdsRef.current = new Set()
    hydratingWorkspacePromisesRef.current = new Map()
    scrollbackLoadedWorkspaceIdsRef.current = new Set()
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

      if (resolvedActiveWorkspaceId) {
        const activePersistedWorkspace =
          persistedWorkspaceByIdRef.current.get(resolvedActiveWorkspaceId) ?? null

        if (activePersistedWorkspace) {
          // Cold-start terminal scrollback loads can race persistence IPC readiness. Retry briefly
          // for the initial workspace; agent restore must come from the runtime presentation path.
          const MAX_SCROLLBACK_LOAD_ATTEMPTS =
            window.opencoveApi?.meta?.runtime === 'electron' ? 2 : 1
          for (
            let attempt = 0;
            attempt < MAX_SCROLLBACK_LOAD_ATTEMPTS && !isCancelledRef.current;
            attempt += 1
          ) {
            // eslint-disable-next-line no-await-in-loop -- bounded retries
            const didLoad = await loadWorkspaceScrollbacks(activePersistedWorkspace)
            if (didLoad) {
              break
            }

            if (attempt < MAX_SCROLLBACK_LOAD_ATTEMPTS - 1) {
              // eslint-disable-next-line no-await-in-loop -- bounded retries
              await delay(80)
            }
          }

          if (isCancelledRef.current) {
            return
          }
        }
      }

      const initialWorkspaces = persisted.workspaces.map(workspace =>
        toShellWorkspaceState(workspace, { dropRuntimeSessionIds: true }),
      )

      setWorkspaces(initialWorkspaces)
      setActiveWorkspaceId(resolvedActiveWorkspaceId)
      setIsPersistReady(true)

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
    ensureWorkspaceHydrated,
    loadWorkspaceScrollbacks,
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
