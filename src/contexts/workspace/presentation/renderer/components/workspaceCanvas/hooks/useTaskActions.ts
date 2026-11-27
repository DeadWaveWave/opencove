import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import {
  resolveTaskTitleModel,
  resolveTaskTitleProvider,
  type AgentSettings,
} from '@contexts/settings/domain/agentSettings'
import type { TaskPriority, TaskRuntimeStatus, TerminalNodeData } from '../../../types'
import { normalizeTaskPriority, normalizeTaskTagSelection } from '../helpers'
import type { CreateNodeInput, WorkspaceCanvasProps } from '../types'
import { resumeTaskAgentSessionAction, runTaskAgentAction } from './useTaskActions.agentSession'
import { useCanvasDocumentCommands, useReadCanvasDocument } from '../../../store/canvasStoreContext'
import {
  mapNodesKeepingIdentity,
  type TaskActionContext,
} from './useTaskActions.agentSession.shared'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'
import { resolveTerminalDisplayMetrics } from './useTerminalDisplayMetrics'

interface UseTaskActionsParams {
  /** The app's settings when an action starts (S7 of #647, Decision 2): never a render's copy. */
  readAgentSettings: () => AgentSettings
  /** The display calibration when a launch starts: a font load or a display change moves it. */
  readTerminalDisplayCalibration: NonNullable<
    WorkspaceCanvasProps['readTerminalDisplayCalibration']
  >
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  buildAgentNodeTitle: (
    provider: AgentSettings['defaultProvider'],
    effectiveModel: string | null,
  ) => string
  launchAgentInNode: TaskActionContext['launchAgentInNode']
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  taskTagOptions: string[]
}

/**
 * The task family's commands (S7 of #647) and the title suggestion of the task editor. A command
 * keeps the workspace, the document reader and the writer of the render that made it, so an action
 * that started in A and finishes after the switch to B writes A. It reads the settings and the
 * display calibration once, when it starts, and never again after an await.
 */
export function useWorkspaceCanvasTaskActions({
  readAgentSettings,
  readTerminalDisplayCalibration,
  createNodeForSession,
  buildAgentNodeTitle,
  launchAgentInNode,
  workspaceId,
  workspacePath,
  environmentVariables,
  taskTagOptions,
}: UseTaskActionsParams): {
  runTaskAgent: (nodeId: string) => Promise<void>
  resumeTaskAgentSession: (taskNodeId: string, recordId: string) => Promise<void>
  removeTaskAgentSessionRecord: (taskNodeId: string, recordId: string) => void
  updateTaskStatus: (nodeId: string, status: TaskRuntimeStatus) => void
  quickUpdateTaskTitle: (nodeId: string, title: string) => void
  quickUpdateTaskRequirement: (nodeId: string, requirement: string) => void
  suggestTaskTitle: (
    requirement: string,
  ) => Promise<{ title: string; priority: TaskPriority; tags: string[] }>
} {
  const { t } = useTranslation()
  const documentCommands = useCanvasDocumentCommands()
  const readDocument = useReadCanvasDocument()
  const { updateNodes, updateCanvasDocument } = useCanvasNodeWriter()

  const runTaskAgent = useCallback(
    async (taskNodeId: string) => {
      const settings = readAgentSettings()
      await runTaskAgentAction(taskNodeId, {
        readDocument,
        updateNodes,
        updateCanvasDocument,
        updateSpaces: documentCommands.updateSpaces,
        createNodeForSession,
        buildAgentNodeTitle,
        launchAgentInNode,
        agentSettings: settings,
        workspaceId,
        workspacePath,
        environmentVariables,
        t,
        terminalDisplayMetrics: resolveTerminalDisplayMetrics({
          terminalFontSize: settings.terminalFontSize,
          terminalDisplayCalibration: readTerminalDisplayCalibration(),
        }),
      })
    },
    [
      buildAgentNodeTitle,
      createNodeForSession,
      documentCommands,
      environmentVariables,
      launchAgentInNode,
      readAgentSettings,
      readDocument,
      readTerminalDisplayCalibration,
      t,
      updateCanvasDocument,
      updateNodes,
      workspaceId,
      workspacePath,
    ],
  )

  const removeTaskAgentSessionRecord = useCallback(
    (taskNodeId: string, recordId: string) => {
      updateNodes(
        prevNodes =>
          mapNodesKeepingIdentity(prevNodes, node => {
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
        { flush: true },
      )
    },
    [updateNodes],
  )

  const resumeTaskAgentSession = useCallback(
    async (taskNodeId: string, recordId: string) => {
      const settings = readAgentSettings()
      await resumeTaskAgentSessionAction(taskNodeId, recordId, {
        readDocument,
        updateNodes,
        updateCanvasDocument,
        updateSpaces: documentCommands.updateSpaces,
        createNodeForSession,
        buildAgentNodeTitle,
        agentSettings: settings,
        workspaceId,
        workspacePath,
        environmentVariables,
        t,
        terminalDisplayMetrics: resolveTerminalDisplayMetrics({
          terminalFontSize: settings.terminalFontSize,
          terminalDisplayCalibration: readTerminalDisplayCalibration(),
        }),
      })
    },
    [
      buildAgentNodeTitle,
      createNodeForSession,
      documentCommands,
      environmentVariables,
      readAgentSettings,
      readDocument,
      readTerminalDisplayCalibration,
      t,
      updateCanvasDocument,
      updateNodes,
      workspaceId,
      workspacePath,
    ],
  )

  const updateTaskStatus = useCallback(
    (taskNodeId: string, status: TaskRuntimeStatus) => {
      updateNodes(
        prevNodes =>
          mapNodesKeepingIdentity(prevNodes, node => {
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
        { flush: true },
      )
    },
    [updateNodes],
  )

  const quickUpdateTaskTitle = useCallback(
    (taskNodeId: string, nextTitle: string) => {
      const normalizedTitle = nextTitle.trim()

      const now = new Date().toISOString()
      updateNodes(
        prevNodes =>
          mapNodesKeepingIdentity(prevNodes, node => {
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
        { flush: true },
      )
    },
    [updateNodes],
  )

  const quickUpdateTaskRequirement = useCallback(
    (taskNodeId: string, nextRequirement: string) => {
      const normalizedRequirement = nextRequirement.trim()
      if (normalizedRequirement.length === 0) {
        return
      }

      const now = new Date().toISOString()
      updateNodes(
        prevNodes =>
          mapNodesKeepingIdentity(prevNodes, node => {
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
        { flush: true },
      )
    },
    [updateNodes],
  )

  const suggestTaskTitle = useCallback(
    async (
      requirement: string,
    ): Promise<{ title: string; priority: TaskPriority; tags: string[] }> => {
      // A callback of the task editor, not a command: it reads the settings when it runs.
      const settings = readAgentSettings()
      const provider = resolveTaskTitleProvider(settings)
      const model = resolveTaskTitleModel(settings)

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
    [readAgentSettings, taskTagOptions, workspacePath],
  )

  return {
    runTaskAgent,
    resumeTaskAgentSession,
    removeTaskAgentSessionRecord,
    updateTaskStatus,
    quickUpdateTaskTitle,
    quickUpdateTaskRequirement,
    suggestTaskTitle,
  }
}
