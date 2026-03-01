import type { Node } from '@xyflow/react'
import { useEffect, useState } from 'react'
import type { AgentSettings } from '../../features/settings/agentConfig'
import type {
  PersistedWorkspaceState,
  TerminalNodeData,
  WorkspaceState,
} from '../../features/workspace/types'
import { useScrollbackStore } from '../../features/workspace/store/useScrollbackStore'
import { readPersistedStateWithMeta } from '../../features/workspace/utils/persistence'
import { getPersistencePort } from '../../features/workspace/utils/persistence/port'
import { toRuntimeNodes } from '../../features/workspace/utils/nodeTransform'
import { toAgentNodeTitle, toErrorMessage } from '../utils/format'
import { useAppStore } from '../store/useAppStore'
import { sanitizeWorkspaceSpaces } from '../utils/workspaceSpaces'

function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
  return result.status === 'fulfilled'
}

function mergeHydratedWorkspaceState(
  current: WorkspaceState,
  hydrated: WorkspaceState,
): WorkspaceState {
  if (current.id !== hydrated.id) {
    return current
  }

  const existingNodeIds = new Set(current.nodes.map(node => node.id))
  const mergedNodes = current.nodes.concat(
    hydrated.nodes.filter(node => !existingNodeIds.has(node.id)),
  )

  const validNodeIds = new Set(mergedNodes.map(node => node.id))
  const nextSpaces = sanitizeWorkspaceSpaces(
    current.spaces.map(space => ({
      ...space,
      nodeIds: space.nodeIds.filter(nodeId => validNodeIds.has(nodeId)),
    })),
  )

  const nextActiveSpaceId =
    current.activeSpaceId !== null && nextSpaces.some(space => space.id === current.activeSpaceId)
      ? current.activeSpaceId
      : null

  return {
    ...current,
    nodes: mergedNodes,
    spaces: nextSpaces,
    activeSpaceId: nextActiveSpaceId,
  }
}

export function useHydrateAppState({
  setAgentSettings,
  setWorkspaces,
  setActiveWorkspaceId,
}: {
  setAgentSettings: React.Dispatch<React.SetStateAction<AgentSettings>>
  setWorkspaces: React.Dispatch<React.SetStateAction<WorkspaceState[]>>
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>
}): { isHydrated: boolean } {
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    let isCancelled = false
    useScrollbackStore.getState().clearAllScrollbacks()
    const hydrateWorkspace = async (
      workspace: PersistedWorkspaceState,
    ): Promise<WorkspaceState> => {
      const runtimeNodes = toRuntimeNodes(workspace)

      const hydratedNodeResults = await Promise.allSettled(
        runtimeNodes.map(async node => {
          if (node.data.kind === 'task') {
            return {
              ...node,
              data: {
                ...node.data,
                sessionId: '',
                status: null,
                startedAt: null,
                endedAt: null,
                exitCode: null,
                lastError: null,
                scrollback: null,
                agent: null,
              },
            }
          }

          if (node.data.kind === 'agent' && node.data.agent) {
            const shouldAutoResumeAgent =
              node.data.status === 'running' ||
              node.data.status === 'standby' ||
              node.data.status === 'restoring'

            if (shouldAutoResumeAgent) {
              try {
                const restoredAgent = await window.coveApi.agent.launch({
                  provider: node.data.agent.provider,
                  cwd: node.data.agent.executionDirectory,
                  prompt: node.data.agent.prompt,
                  mode: 'resume',
                  model: node.data.agent.model,
                  resumeSessionId: node.data.agent.resumeSessionId,
                  cols: 80,
                  rows: 24,
                })

                return {
                  ...node,
                  data: {
                    ...node.data,
                    sessionId: restoredAgent.sessionId,
                    title: toAgentNodeTitle(node.data.agent.provider, restoredAgent.effectiveModel),
                    status: 'running' as const,
                    endedAt: null,
                    exitCode: null,
                    lastError: null,
                    scrollback: node.data.scrollback,
                    startedAt: node.data.startedAt ?? new Date().toISOString(),
                    agent: {
                      ...node.data.agent,
                      effectiveModel: restoredAgent.effectiveModel,
                      launchMode: restoredAgent.launchMode,
                      resumeSessionId:
                        restoredAgent.resumeSessionId ?? node.data.agent.resumeSessionId,
                    },
                  },
                }
              } catch (error) {
                const now = new Date().toISOString()
                const resumeError = toErrorMessage(error)

                try {
                  const fallback = await window.coveApi.pty.spawn({
                    cwd: workspace.path,
                    cols: 80,
                    rows: 24,
                  })

                  return {
                    ...node,
                    data: {
                      ...node.data,
                      sessionId: fallback.sessionId,
                      status: 'failed' as const,
                      endedAt: now,
                      exitCode: null,
                      lastError: `Resume failed: ${resumeError}`,
                      scrollback: node.data.scrollback,
                    },
                  }
                } catch (fallbackError) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      sessionId: '',
                      status: 'failed' as const,
                      endedAt: now,
                      exitCode: null,
                      lastError: `Resume failed: ${resumeError}. Fallback terminal failed: ${toErrorMessage(fallbackError)}`,
                      scrollback: node.data.scrollback,
                    },
                  }
                }
              }
            }

            try {
              const spawned = await window.coveApi.pty.spawn({
                cwd: node.data.agent.executionDirectory,
                cols: 80,
                rows: 24,
              })

              return {
                ...node,
                data: {
                  ...node.data,
                  sessionId: spawned.sessionId,
                },
              }
            } catch (error) {
              const now = new Date().toISOString()
              const spawnError = toErrorMessage(error)

              try {
                const fallback = await window.coveApi.pty.spawn({
                  cwd: workspace.path,
                  cols: 80,
                  rows: 24,
                })

                return {
                  ...node,
                  data: {
                    ...node.data,
                    sessionId: fallback.sessionId,
                    status: 'failed' as const,
                    endedAt: now,
                    exitCode: null,
                    lastError: `Terminal spawn failed: ${spawnError}`,
                    scrollback: node.data.scrollback,
                  },
                }
              } catch (fallbackError) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    sessionId: '',
                    status: 'failed' as const,
                    endedAt: now,
                    exitCode: null,
                    lastError: `Terminal spawn failed: ${spawnError}. Fallback terminal failed: ${toErrorMessage(fallbackError)}`,
                    scrollback: node.data.scrollback,
                  },
                }
              }
            }
          }

          const spawned = await window.coveApi.pty.spawn({
            cwd: workspace.path,
            cols: 80,
            rows: 24,
          })

          return {
            ...node,
            data: {
              ...node.data,
              sessionId: spawned.sessionId,
              kind: 'terminal' as const,
              status: null,
              startedAt: null,
              endedAt: null,
              exitCode: null,
              lastError: null,
              scrollback: node.data.scrollback,
              agent: null,
              task: null,
            },
          }
        }),
      )

      const hydratedNodes = hydratedNodeResults
        .filter(isFulfilled)
        .map(result => result.value as Node<TerminalNodeData>)
      const hydratedNodeIds = new Set(hydratedNodes.map(node => node.id))
      const sanitizedSpaces = sanitizeWorkspaceSpaces(
        workspace.spaces.map(space => ({
          ...space,
          nodeIds: space.nodeIds.filter(nodeId => hydratedNodeIds.has(nodeId)),
        })),
      )
      const hasActiveSpace =
        workspace.activeSpaceId !== null &&
        sanitizedSpaces.some(space => space.id === workspace.activeSpaceId)

      return {
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        worktreesRoot: workspace.worktreesRoot,
        nodes: hydratedNodes,
        viewport: {
          x: workspace.viewport.x,
          y: workspace.viewport.y,
          zoom: workspace.viewport.zoom,
        },
        isMinimapVisible: workspace.isMinimapVisible,
        spaces: sanitizedSpaces,
        activeSpaceId: hasActiveSpace ? workspace.activeSpaceId : null,
      }
    }

    const applyHydratedWorkspace = (hydratedWorkspace: WorkspaceState): void => {
      if (isCancelled) {
        return
      }

      setWorkspaces(previous =>
        previous.map(workspace =>
          workspace.id === hydratedWorkspace.id
            ? mergeHydratedWorkspaceState(workspace, hydratedWorkspace)
            : workspace,
        ),
      )
    }

    const restore = async (
      persisted: {
        activeWorkspaceId: string | null
        workspaces: PersistedWorkspaceState[]
      },
      resolvedActiveWorkspaceId: string | null,
    ): Promise<void> => {
      const activeWorkspace = resolvedActiveWorkspaceId
        ? (persisted.workspaces.find(workspace => workspace.id === resolvedActiveWorkspaceId) ??
          null)
        : null

      if (activeWorkspace) {
        const hydratedActiveWorkspace = await hydrateWorkspace(activeWorkspace)
        applyHydratedWorkspace(hydratedActiveWorkspace)
      }

      const remainingWorkspaces = persisted.workspaces.filter(
        workspace => workspace.id !== resolvedActiveWorkspaceId,
      )

      if (remainingWorkspaces.length === 0) {
        return
      }

      const hydratedRemainingWorkspaces = await Promise.all(
        remainingWorkspaces.map(workspace => hydrateWorkspace(workspace)),
      )

      if (isCancelled) {
        return
      }

      const hydratedWorkspaceById = new Map(
        hydratedRemainingWorkspaces.map(workspace => [workspace.id, workspace]),
      )
      setWorkspaces(previous =>
        previous.map(workspace => {
          const hydratedWorkspace = hydratedWorkspaceById.get(workspace.id)
          if (!hydratedWorkspace) {
            return workspace
          }

          return mergeHydratedWorkspaceState(workspace, hydratedWorkspace)
        }),
      )
    }

    const hydrateAppState = async (): Promise<void> => {
      const { state: persisted, recovery } = await readPersistedStateWithMeta()
      if (isCancelled) {
        return
      }

      if (recovery) {
        const recoveryMessage =
          recovery === 'corrupt_db'
            ? 'Persistence database was corrupted and has been reset.'
            : 'Persistence migration failed and has been reset.'
        useAppStore
          .getState()
          .setPersistNotice({ tone: 'warning', message: recoveryMessage, kind: 'recovery' })
      }

      if (!persisted) {
        setIsHydrated(true)
        return
      }

      setAgentSettings(persisted.settings)

      if (persisted.workspaces.length === 0) {
        setIsHydrated(true)
        return
      }

      const hasActiveWorkspace = persisted.workspaces.some(
        workspace => workspace.id === persisted.activeWorkspaceId,
      )
      const resolvedActiveWorkspaceId = hasActiveWorkspace
        ? persisted.activeWorkspaceId
        : (persisted.workspaces[0]?.id ?? null)

      setWorkspaces(
        persisted.workspaces.map(workspace => {
          const sanitizedSpaces = sanitizeWorkspaceSpaces(workspace.spaces)
          const hasActiveSpace =
            workspace.activeSpaceId !== null &&
            sanitizedSpaces.some(space => space.id === workspace.activeSpaceId)

          return {
            id: workspace.id,
            name: workspace.name,
            path: workspace.path,
            worktreesRoot: workspace.worktreesRoot,
            nodes: [],
            viewport: {
              x: workspace.viewport.x,
              y: workspace.viewport.y,
              zoom: workspace.viewport.zoom,
            },
            isMinimapVisible: workspace.isMinimapVisible,
            spaces: sanitizedSpaces,
            activeSpaceId: hasActiveSpace ? workspace.activeSpaceId : null,
          }
        }),
      )
      setActiveWorkspaceId(resolvedActiveWorkspaceId)

      try {
        const port = getPersistencePort()
        if (port) {
          const nodeIds = persisted.workspaces.flatMap(workspace =>
            workspace.nodes.filter(node => node.kind !== 'task').map(node => node.id),
          )

          const scrollbackResults = await Promise.allSettled(
            nodeIds.map(nodeId => port.readNodeScrollback(nodeId)),
          )

          if (!isCancelled) {
            const scrollbacks: Record<string, string> = {}
            scrollbackResults.forEach((result, index) => {
              if (result.status !== 'fulfilled' || !result.value) {
                return
              }

              scrollbacks[nodeIds[index] as string] = result.value
            })

            useScrollbackStore.getState().hydrateScrollbacks(scrollbacks)
          }
        }

        await restore(persisted, resolvedActiveWorkspaceId)
      } finally {
        if (!isCancelled) {
          setIsHydrated(true)
        }
      }
    }

    void hydrateAppState()

    return () => {
      isCancelled = true
    }
  }, [setActiveWorkspaceId, setAgentSettings, setWorkspaces])

  return { isHydrated }
}
