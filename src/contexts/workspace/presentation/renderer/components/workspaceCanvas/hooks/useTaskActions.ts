import { useCallback, useEffect, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import {
  resolveTaskTitleModel,
  resolveTaskTitleProvider,
  type AgentSettings,
} from '@contexts/settings/domain/agentSettings'
import type {
  TaskPriority,
  TaskRuntimeStatus,
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../types'
import { normalizeTaskPriority, normalizeTaskTagSelection } from '../helpers'
import type {
  CreateNodeInput,
  QuickUpdateTaskRequirement,
  QuickUpdateTaskTitle,
  UpdateTaskStatus,
} from '../types'
import { resumeTaskAgentSessionAction, runTaskAgentAction } from './useTaskActions.agentSession'

interface UseTaskActionsParams {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  buildAgentNodeTitle: (
    provider: AgentSettings['defaultProvider'],
    effectiveModel: string | null,
  ) => string
  launchAgentInNode: (nodeId: string, mode: 'new' | 'resume') => Promise<void>
  agentSettings: AgentSettings
  workspacePath: string
  taskTagOptions: string[]
  onRequestPersistFlush?: () => void
  runTaskAgentRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resumeTaskAgentSessionRef: MutableRefObject<
    (taskNodeId: string, recordId: string) => Promise<void>
  >
  removeTaskAgentSessionRecordRef: MutableRefObject<(taskNodeId: string, recordId: string) => void>
  updateTaskStatusRef: MutableRefObject<UpdateTaskStatus>
  quickUpdateTaskTitleRef: MutableRefObject<QuickUpdateTaskTitle>
  quickUpdateTaskRequirementRef: MutableRefObject<QuickUpdateTaskRequirement>
}

export function useWorkspaceCanvasTaskActions({
  nodesRef,
  spacesRef,
  onSpacesChange,
  setNodes,
  createNodeForSession,
  buildAgentNodeTitle,
  launchAgentInNode,
  agentSettings,
  workspacePath,
  taskTagOptions,
  onRequestPersistFlush,
  runTaskAgentRef,
  resumeTaskAgentSessionRef,
  removeTaskAgentSessionRecordRef,
  updateTaskStatusRef,
  quickUpdateTaskTitleRef,
  quickUpdateTaskRequirementRef,
}: UseTaskActionsParams): {
  suggestTaskTitle: (
    requirement: string,
  ) => Promise<{ title: string; priority: TaskPriority; tags: string[] }>
} {
  const { t } = useTranslation()

  const runTaskAgent = useCallback(
    async (taskNodeId: string) => {
      await runTaskAgentAction(taskNodeId, {
        nodesRef,
        spacesRef,
        onSpacesChange,
        setNodes,
        createNodeForSession,
        buildAgentNodeTitle,
        launchAgentInNode,
        agentSettings,
        workspacePath,
        t,
        onRequestPersistFlush,
      })
    },
    [
      agentSettings,
      buildAgentNodeTitle,
      createNodeForSession,
      launchAgentInNode,
      nodesRef,
      onSpacesChange,
      onRequestPersistFlush,
      setNodes,
      spacesRef,
      t,
      workspacePath,
    ],
  )

  const removeTaskAgentSessionRecord = useCallback(
    (taskNodeId: string, recordId: string) => {
      setNodes(prevNodes =>
        prevNodes.map(node => {
          if (node.id !== taskNodeId || node.data.kind !== 'task' || !node.data.task) {
            return node
          }

          const nextSessions = (node.data.task.agentSessions ?? []).filter(
            record => record.id !== recordId,
          )

          return {
            ...node,
            data: {
              ...node.data,
              task: {
                ...node.data.task,
                agentSessions: nextSessions,
                updatedAt: new Date().toISOString(),
              },
            },
          }
        }),
      )

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, setNodes],
  )

  const resumeTaskAgentSession = useCallback(
    async (taskNodeId: string, recordId: string) => {
      await resumeTaskAgentSessionAction(taskNodeId, recordId, {
        nodesRef,
        spacesRef,
        onSpacesChange,
        setNodes,
        createNodeForSession,
        buildAgentNodeTitle,
        agentSettings,
        workspacePath,
        t,
        onRequestPersistFlush,
      })
    },
    [
      agentSettings,
      buildAgentNodeTitle,
      createNodeForSession,
      nodesRef,
      onRequestPersistFlush,
      onSpacesChange,
      setNodes,
      spacesRef,
      t,
      workspacePath,
    ],
  )

  const updateTaskStatus = useCallback(
    (taskNodeId: string, status: TaskRuntimeStatus) => {
      setNodes(prevNodes =>
        prevNodes.map(node => {
          if (node.id !== taskNodeId || node.data.kind !== 'task' || !node.data.task) {
            return node
          }

          return {
            ...node,
            data: {
              ...node.data,
              task: {
                ...node.data.task,
                status,
                updatedAt: new Date().toISOString(),
              },
            },
          }
        }),
      )

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, setNodes],
  )

  const quickUpdateTaskTitle = useCallback(
    (taskNodeId: string, nextTitle: string) => {
      const normalizedTitle = nextTitle.trim()
      if (normalizedTitle.length === 0) {
        return
      }

      const now = new Date().toISOString()
      setNodes(prevNodes =>
        prevNodes.map(node => {
          if (node.id !== taskNodeId || node.data.kind !== 'task' || !node.data.task) {
            return node
          }

          return {
            ...node,
            data: {
              ...node.data,
              title: normalizedTitle,
              lastError: null,
              task: {
                ...node.data.task,
                autoGeneratedTitle: false,
                updatedAt: now,
              },
            },
          }
        }),
      )

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, setNodes],
  )

  const quickUpdateTaskRequirement = useCallback(
    (taskNodeId: string, nextRequirement: string) => {
      const normalizedRequirement = nextRequirement.trim()
      if (normalizedRequirement.length === 0) {
        return
      }

      const now = new Date().toISOString()
      setNodes(prevNodes =>
        prevNodes.map(node => {
          if (node.id !== taskNodeId || node.data.kind !== 'task' || !node.data.task) {
            return node
          }

          return {
            ...node,
            data: {
              ...node.data,
              lastError: null,
              task: {
                ...node.data.task,
                requirement: normalizedRequirement,
                updatedAt: now,
              },
            },
          }
        }),
      )

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, setNodes],
  )

  const suggestTaskTitle = useCallback(
    async (
      requirement: string,
    ): Promise<{ title: string; priority: TaskPriority; tags: string[] }> => {
      const provider = resolveTaskTitleProvider(agentSettings)
      const model = resolveTaskTitleModel(agentSettings)

      const suggested = await window.opencoveApi.task.suggestTitle({
        provider,
        cwd: workspacePath,
        requirement,
        model,
        availableTags: taskTagOptions,
      })

      return {
        title: suggested.title,
        priority: normalizeTaskPriority(suggested.priority),
        tags: normalizeTaskTagSelection(suggested.tags, taskTagOptions),
      }
    },
    [agentSettings, taskTagOptions, workspacePath],
  )

  useEffect(() => {
    runTaskAgentRef.current = async nodeId => {
      await runTaskAgent(nodeId)
    }
  }, [runTaskAgent, runTaskAgentRef])

  useEffect(() => {
    resumeTaskAgentSessionRef.current = async (taskNodeId, recordId) => {
      await resumeTaskAgentSession(taskNodeId, recordId)
    }
  }, [resumeTaskAgentSession, resumeTaskAgentSessionRef])

  useEffect(() => {
    removeTaskAgentSessionRecordRef.current = (taskNodeId, recordId) => {
      removeTaskAgentSessionRecord(taskNodeId, recordId)
    }
  }, [removeTaskAgentSessionRecord, removeTaskAgentSessionRecordRef])

  useEffect(() => {
    updateTaskStatusRef.current = (nodeId, status) => {
      updateTaskStatus(nodeId, status)
    }
  }, [updateTaskStatus, updateTaskStatusRef])

  useEffect(() => {
    quickUpdateTaskTitleRef.current = (nodeId, title) => {
      quickUpdateTaskTitle(nodeId, title)
    }
  }, [quickUpdateTaskTitle, quickUpdateTaskTitleRef])

  useEffect(() => {
    quickUpdateTaskRequirementRef.current = (nodeId, requirement) => {
      quickUpdateTaskRequirement(nodeId, requirement)
    }
  }, [quickUpdateTaskRequirement, quickUpdateTaskRequirementRef])

  return { suggestTaskTitle }
}
