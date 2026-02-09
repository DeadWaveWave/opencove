import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import {
  AGENT_PROVIDER_LABEL,
  AGENT_PROVIDERS,
  resolveAgentModel,
  resolveTaskTitleModel,
  resolveTaskTitleProvider,
  type AgentProvider,
  type AgentSettings,
} from '../../settings/agentConfig'
import { TaskNode } from './TaskNode'
import { TerminalNode } from './TerminalNode'
import type { AgentNodeData, Point, Size, TaskRuntimeStatus, TerminalNodeData } from '../types'
import {
  clampSizeToNonOverlapping,
  findNearestFreePosition,
  isPositionAvailable,
} from '../utils/collision'

interface WorkspaceCanvasProps {
  workspacePath: string
  nodes: Node<TerminalNodeData>[]
  onNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  agentSettings: AgentSettings
  focusNodeId?: string | null
  focusSequence?: number
}

interface ContextMenuState {
  x: number
  y: number
  flowX: number
  flowY: number
}

interface AgentLauncherState {
  anchor: Point
  provider: AgentProvider
  prompt: string
  model: string
  directoryMode: 'workspace' | 'custom'
  customDirectory: string
  shouldCreateDirectory: boolean
  isLaunching: boolean
  error: string | null
}

interface TaskCreatorState {
  anchor: Point
  title: string
  requirement: string
  autoGenerateTitle: boolean
  isGeneratingTitle: boolean
  isCreating: boolean
  error: string | null
}

interface CreateNodeInput {
  sessionId: string
  title: string
  anchor: Point
  kind: 'terminal' | 'agent'
  agent?: AgentNodeData | null
}

const DEFAULT_SIZE: Size = {
  width: 460,
  height: 300,
}

const TASK_SIZE: Size = {
  width: 460,
  height: 280,
}

const MIN_SIZE: Size = {
  width: 320,
  height: 220,
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.length > 0) {
    return error
  }

  return 'Unknown error'
}

function providerLabel(provider: AgentProvider): string {
  return AGENT_PROVIDER_LABEL[provider]
}

function providerTitlePrefix(provider: AgentProvider): string {
  return provider === 'codex' ? 'codex' : 'claude'
}

function normalizeDirectoryPath(workspacePath: string, customDirectory: string): string {
  const trimmed = customDirectory.trim()
  if (trimmed.length === 0) {
    return ''
  }

  if (/^([a-zA-Z]:[\\/]|\/)/.test(trimmed)) {
    return trimmed
  }

  const base = workspacePath.replace(/[\\/]+$/, '')
  const normalizedCustom = trimmed.replace(/^[./\\]+/, '')
  return `${base}/${normalizedCustom}`
}

function toSuggestedWorktreePath(workspacePath: string, provider: AgentProvider): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${workspacePath}/.cove/worktrees/${providerTitlePrefix(provider)}-${stamp}`
}

function WorkspaceCanvasInner({
  workspacePath,
  nodes,
  onNodesChange,
  agentSettings,
  focusNodeId,
  focusSequence,
}: WorkspaceCanvasProps): JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [agentLauncher, setAgentLauncher] = useState<AgentLauncherState | null>(null)
  const [taskCreator, setTaskCreator] = useState<TaskCreatorState | null>(null)

  const reactFlow = useReactFlow<TerminalNodeData>()
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const nodesRef = useRef(nodes)
  const closeNodeRef = useRef<(nodeId: string) => Promise<void>>(async () => undefined)
  const resizeNodeRef = useRef<(nodeId: string, desiredSize: Size) => void>(() => undefined)
  const stopAgentNodeRef = useRef<(nodeId: string) => Promise<void>>(async () => undefined)
  const rerunAgentNodeRef = useRef<(nodeId: string) => Promise<void>>(async () => undefined)
  const resumeAgentNodeRef = useRef<(nodeId: string) => Promise<void>>(async () => undefined)
  const runTaskAgentRef = useRef<(nodeId: string) => Promise<void>>(async () => undefined)
  const updateTaskStatusRef = useRef<(nodeId: string, status: TaskRuntimeStatus) => void>(
    () => undefined,
  )
  const updateNodeScrollbackRef = useRef<(nodeId: string, scrollback: string) => void>(
    () => undefined,
  )
  const isNodeDraggingRef = useRef(false)
  const pendingScrollbackByNodeRef = useRef<Map<string, string>>(new Map())
  const normalizeViewportForTerminalInteractionRef = useRef<(nodeId: string) => void>(
    () => undefined,
  )

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const setNodes = useCallback(
    (
      updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
      options: { syncLayout?: boolean } = {},
    ) => {
      const previousNodes = nodesRef.current
      const nextNodes = updater(previousNodes)

      if (nextNodes === previousNodes) {
        return
      }

      nodesRef.current = nextNodes
      onNodesChange(nextNodes)

      if (options.syncLayout ?? true) {
        window.dispatchEvent(new Event('cove:terminal-layout-sync'))
      }
    },
    [onNodesChange],
  )

  const upsertNode = useCallback(
    (nextNode: Node<TerminalNodeData>) => {
      setNodes(prevNodes => prevNodes.map(node => (node.id === nextNode.id ? nextNode : node)))
    },
    [setNodes],
  )

  const closeNode = useCallback(
    async (nodeId: string) => {
      const target = nodesRef.current.find(node => node.id === nodeId)
      if (target && target.data.sessionId.length > 0) {
        await window.coveApi.pty.kill({ sessionId: target.data.sessionId })
      }

      setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeId))
    },
    [setNodes],
  )

  const normalizePosition = useCallback((nodeId: string, desired: Point, size: Size): Point => {
    return findNearestFreePosition(desired, size, nodesRef.current, nodeId)
  }, [])

  const resizeNode = useCallback(
    (nodeId: string, desiredSize: Size) => {
      const node = nodesRef.current.find(item => item.id === nodeId)
      if (!node) {
        return
      }

      const boundedSize = clampSizeToNonOverlapping(
        node.position,
        desiredSize,
        MIN_SIZE,
        nodesRef.current,
        nodeId,
      )

      upsertNode({
        ...node,
        data: {
          ...node.data,
          width: boundedSize.width,
          height: boundedSize.height,
        },
      })
    },
    [upsertNode],
  )

  const applyPendingScrollbacks = useCallback((targetNodes: Node<TerminalNodeData>[]) => {
    const pendingScrollbacks = pendingScrollbackByNodeRef.current
    if (pendingScrollbacks.size === 0) {
      return targetNodes
    }

    let hasChanged = false

    const nextNodes = targetNodes.map(node => {
      if (node.data.kind === 'task') {
        return node
      }

      const pending = pendingScrollbacks.get(node.id)
      if (pending === undefined) {
        return node
      }

      const normalized = pending.length > 0 ? pending : null
      if (node.data.scrollback === normalized) {
        return node
      }

      hasChanged = true

      return {
        ...node,
        data: {
          ...node.data,
          scrollback: normalized,
        },
      }
    })

    pendingScrollbacks.clear()
    return hasChanged ? nextNodes : targetNodes
  }, [])

  const updateNodeScrollback = useCallback(
    (nodeId: string, scrollback: string) => {
      if (isNodeDraggingRef.current) {
        pendingScrollbackByNodeRef.current.set(nodeId, scrollback)
        return
      }

      const normalized = scrollback.length > 0 ? scrollback : null

      setNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (node.id !== nodeId || node.data.kind === 'task') {
              return node
            }

            if (node.data.scrollback === normalized) {
              return node
            }

            hasChanged = true

            return {
              ...node,
              data: {
                ...node.data,
                scrollback: normalized,
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )
    },
    [setNodes],
  )

  const buildAgentNodeTitle = useCallback(
    (provider: AgentProvider, effectiveModel: string | null): string => {
      return `${providerTitlePrefix(provider)} · ${effectiveModel ?? 'default-model'}`
    },
    [],
  )

  const createNodeForSession = useCallback(
    async ({
      sessionId,
      title,
      anchor,
      kind,
      agent,
    }: CreateNodeInput): Promise<Node<TerminalNodeData> | null> => {
      const currentNodes = nodesRef.current
      const nonOverlappingPosition = findNearestFreePosition(anchor, DEFAULT_SIZE, currentNodes)
      const canPlace = isPositionAvailable(nonOverlappingPosition, DEFAULT_SIZE, currentNodes)

      if (!canPlace) {
        await window.coveApi.pty.kill({ sessionId })
        window.alert('当前视图附近没有可用空位，请先移动或关闭部分终端窗口。')
        return null
      }

      const now = new Date().toISOString()
      const nextNode: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: 'terminalNode',
        position: nonOverlappingPosition,
        data: {
          sessionId,
          title,
          width: DEFAULT_SIZE.width,
          height: DEFAULT_SIZE.height,
          kind,
          status: kind === 'agent' ? 'running' : null,
          startedAt: kind === 'agent' ? now : null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: kind === 'agent' ? (agent ?? null) : null,
          task: null,
        },
        draggable: true,
        selectable: true,
      }

      setNodes(prevNodes => [...prevNodes, nextNode])
      return nextNode
    },
    [setNodes],
  )

  const createTaskNode = useCallback(
    (
      anchor: Point,
      title: string,
      requirement: string,
      autoGeneratedTitle: boolean,
    ): Node<TerminalNodeData> | null => {
      const currentNodes = nodesRef.current
      const nonOverlappingPosition = findNearestFreePosition(anchor, TASK_SIZE, currentNodes)
      const canPlace = isPositionAvailable(nonOverlappingPosition, TASK_SIZE, currentNodes)

      if (!canPlace) {
        window.alert('当前视图附近没有可用空位，请先移动或关闭部分窗口。')
        return null
      }

      const nextNode: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: 'taskNode',
        position: nonOverlappingPosition,
        data: {
          sessionId: '',
          title,
          width: TASK_SIZE.width,
          height: TASK_SIZE.height,
          kind: 'task',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: null,
          task: {
            requirement,
            status: 'todo',
            linkedAgentNodeId: null,
            lastRunAt: null,
            autoGeneratedTitle,
          },
        },
        draggable: true,
        selectable: true,
      }

      setNodes(prevNodes => [...prevNodes, nextNode])
      return nextNode
    },
    [setNodes],
  )

  const launchAgentInNode = useCallback(
    async (nodeId: string, mode: 'new' | 'resume') => {
      const node = nodesRef.current.find(item => item.id === nodeId)
      if (!node || node.data.kind !== 'agent' || !node.data.agent) {
        return
      }

      const launchData = node.data.agent

      if (mode === 'new' && launchData.prompt.trim().length === 0) {
        setNodes(prevNodes =>
          prevNodes.map(item => {
            if (item.id !== nodeId) {
              return item
            }

            return {
              ...item,
              data: {
                ...item.data,
                status: 'failed',
                lastError: '任务提示词不能为空。',
              },
            }
          }),
        )
        return
      }

      if (launchData.shouldCreateDirectory && launchData.directoryMode === 'custom') {
        await window.coveApi.workspace.ensureDirectory({ path: launchData.executionDirectory })
      }

      if (node.data.sessionId.length > 0) {
        await window.coveApi.pty.kill({ sessionId: node.data.sessionId })
      }

      setNodes(prevNodes =>
        prevNodes.map(item => {
          if (item.id !== nodeId) {
            return item
          }

          return {
            ...item,
            data: {
              ...item.data,
              status: 'restoring',
              endedAt: null,
              exitCode: null,
              lastError: null,
            },
          }
        }),
      )

      try {
        const launched = await window.coveApi.agent.launch({
          provider: launchData.provider,
          cwd: launchData.executionDirectory,
          prompt: launchData.prompt,
          mode,
          model: launchData.model,
          resumeSessionId: mode === 'resume' ? launchData.resumeSessionId : null,
          cols: 80,
          rows: 24,
        })

        setNodes(prevNodes =>
          prevNodes.map(item => {
            if (item.id !== nodeId) {
              return item
            }

            const nextAgentData: AgentNodeData = {
              ...launchData,
              launchMode: launched.launchMode,
              effectiveModel: launched.effectiveModel,
              resumeSessionId: launched.resumeSessionId ?? launchData.resumeSessionId,
            }

            return {
              ...item,
              data: {
                ...item.data,
                sessionId: launched.sessionId,
                title: buildAgentNodeTitle(launchData.provider, launched.effectiveModel),
                status: 'running',
                startedAt:
                  mode === 'new' ? new Date().toISOString() : (item.data.startedAt ?? null),
                endedAt: null,
                exitCode: null,
                lastError: null,
                scrollback: mode === 'new' ? null : item.data.scrollback,
                agent: nextAgentData,
              },
            }
          }),
        )
      } catch (error) {
        const errorMessage = `Agent 启动失败：${toErrorMessage(error)}`

        setNodes(prevNodes =>
          prevNodes.map(item => {
            if (item.id !== nodeId) {
              return item
            }

            return {
              ...item,
              data: {
                ...item.data,
                status: 'failed',
                endedAt: new Date().toISOString(),
                lastError: errorMessage,
              },
            }
          }),
        )
      }
    },
    [buildAgentNodeTitle, setNodes],
  )

  const stopAgentNode = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find(item => item.id === nodeId)
      if (!node || node.data.kind !== 'agent') {
        return
      }

      if (node.data.sessionId.length > 0) {
        await window.coveApi.pty.kill({ sessionId: node.data.sessionId })
      }

      setNodes(prevNodes =>
        prevNodes.map(item => {
          if (item.id !== nodeId) {
            return item
          }

          return {
            ...item,
            data: {
              ...item.data,
              status: 'stopped',
              endedAt: new Date().toISOString(),
              exitCode: null,
            },
          }
        }),
      )
    },
    [setNodes],
  )

  const runTaskAgent = useCallback(
    async (taskNodeId: string) => {
      const taskNode = nodesRef.current.find(node => node.id === taskNodeId)
      if (!taskNode || taskNode.data.kind !== 'task' || !taskNode.data.task) {
        return
      }

      const requirement = taskNode.data.task.requirement.trim()
      if (requirement.length === 0) {
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id !== taskNodeId) {
              return node
            }

            return {
              ...node,
              data: {
                ...node.data,
                lastError: '任务要求不能为空。',
              },
            }
          }),
        )
        return
      }

      const provider = agentSettings.defaultProvider
      const model = resolveAgentModel(agentSettings, provider)

      try {
        const launched = await window.coveApi.agent.launch({
          provider,
          cwd: workspacePath,
          prompt: requirement,
          mode: 'new',
          model,
          cols: 80,
          rows: 24,
        })

        const createdAgentNode = await createNodeForSession({
          sessionId: launched.sessionId,
          title: buildAgentNodeTitle(provider, launched.effectiveModel),
          anchor: {
            x: taskNode.position.x + taskNode.data.width + 48,
            y: taskNode.position.y,
          },
          kind: 'agent',
          agent: {
            provider,
            prompt: requirement,
            model,
            effectiveModel: launched.effectiveModel,
            launchMode: launched.launchMode,
            resumeSessionId: launched.resumeSessionId,
            executionDirectory: workspacePath,
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
            taskId: taskNodeId,
          },
        })

        if (!createdAgentNode) {
          return
        }

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
                  status: 'doing',
                  linkedAgentNodeId: createdAgentNode.id,
                  lastRunAt: new Date().toISOString(),
                },
              },
            }
          }),
        )
      } catch (error) {
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id !== taskNodeId || node.data.kind !== 'task') {
              return node
            }

            return {
              ...node,
              data: {
                ...node.data,
                lastError: `Agent 启动失败：${toErrorMessage(error)}`,
              },
            }
          }),
        )
      }
    },
    [agentSettings, buildAgentNodeTitle, createNodeForSession, setNodes, workspacePath],
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
              },
            },
          }
        }),
      )
    },
    [setNodes],
  )

  const suggestTaskTitle = useCallback(
    async (requirement: string): Promise<string> => {
      const provider = resolveTaskTitleProvider(agentSettings)
      const model = resolveTaskTitleModel(agentSettings)

      const suggested = await window.coveApi.task.suggestTitle({
        provider,
        cwd: workspacePath,
        requirement,
        model,
      })

      return suggested.title
    },
    [agentSettings, workspacePath],
  )

  useEffect(() => {
    closeNodeRef.current = closeNode
  }, [closeNode])

  useEffect(() => {
    resizeNodeRef.current = resizeNode
  }, [resizeNode])

  useEffect(() => {
    stopAgentNodeRef.current = stopAgentNode
  }, [stopAgentNode])

  useEffect(() => {
    rerunAgentNodeRef.current = async nodeId => {
      await launchAgentInNode(nodeId, 'new')
    }
  }, [launchAgentInNode])

  useEffect(() => {
    resumeAgentNodeRef.current = async nodeId => {
      await launchAgentInNode(nodeId, 'resume')
    }
  }, [launchAgentInNode])

  useEffect(() => {
    runTaskAgentRef.current = async nodeId => {
      await runTaskAgent(nodeId)
    }
  }, [runTaskAgent])

  useEffect(() => {
    updateTaskStatusRef.current = (nodeId, status) => {
      updateTaskStatus(nodeId, status)
    }
  }, [updateTaskStatus])

  useEffect(() => {
    updateNodeScrollbackRef.current = (nodeId, scrollback) => {
      updateNodeScrollback(nodeId, scrollback)
    }
  }, [updateNodeScrollback])

  useEffect(() => {
    const unsubscribeExit = window.coveApi.pty.onExit(event => {
      setNodes(prevNodes => {
        let relatedTaskNodeId: string | null = null
        const nextNodes = prevNodes.map(node => {
          if (node.data.sessionId !== event.sessionId || node.data.kind !== 'agent') {
            return node
          }

          if (node.data.status === 'stopped') {
            return node
          }

          relatedTaskNodeId = node.data.agent?.taskId ?? null

          return {
            ...node,
            data: {
              ...node.data,
              status: event.exitCode === 0 ? 'exited' : 'failed',
              endedAt: new Date().toISOString(),
              exitCode: event.exitCode,
            },
          }
        })

        if (!relatedTaskNodeId) {
          return nextNodes
        }

        return nextNodes.map(node => {
          if (node.id !== relatedTaskNodeId || node.data.kind !== 'task' || !node.data.task) {
            return node
          }

          return {
            ...node,
            data: {
              ...node.data,
              task: {
                ...node.data.task,
                status: event.exitCode === 0 ? 'ai_done' : 'doing',
              },
            },
          }
        })
      })
    })

    return () => {
      unsubscribeExit()
    }
  }, [setNodes])

  useEffect(() => {
    if (!focusNodeId) {
      return
    }

    const target = nodes.find(node => node.id === focusNodeId)
    if (!target) {
      return
    }

    reactFlow.setCenter(
      target.position.x + target.data.width / 2,
      target.position.y + target.data.height / 2,
      {
        duration: 220,
        zoom: 1,
      },
    )
  }, [focusNodeId, focusSequence, nodes, reactFlow])

  normalizeViewportForTerminalInteractionRef.current = (nodeId: string) => {
    if (!agentSettings.normalizeZoomOnTerminalClick) {
      return
    }

    const targetNode = nodesRef.current.find(node => node.id === nodeId)
    if (!targetNode || targetNode.data.kind === 'task') {
      return
    }

    reactFlow.setCenter(
      targetNode.position.x + targetNode.data.width / 2,
      targetNode.position.y + targetNode.data.height / 2,
      {
        duration: 120,
        zoom: 1,
      },
    )
  }

  const nodeTypes = useMemo(
    () => ({
      terminalNode: ({ data, id }: { data: TerminalNodeData; id: string }) => (
        <TerminalNode
          sessionId={data.sessionId}
          title={data.title}
          kind={data.kind}
          agentProvider={data.agent?.provider ?? null}
          status={data.status}
          lastError={data.lastError}
          width={data.width}
          height={data.height}
          scrollback={data.scrollback}
          onClose={() => {
            void closeNodeRef.current(id)
          }}
          onResize={size => resizeNodeRef.current(id, size)}
          onScrollbackChange={scrollback => updateNodeScrollbackRef.current(id, scrollback)}
          onInteractionStart={() => normalizeViewportForTerminalInteractionRef.current(id)}
          onStop={
            data.kind === 'agent'
              ? () => {
                  void stopAgentNodeRef.current(id)
                }
              : undefined
          }
          onRerun={
            data.kind === 'agent'
              ? () => {
                  void rerunAgentNodeRef.current(id)
                }
              : undefined
          }
          onResume={
            data.kind === 'agent'
              ? () => {
                  void resumeAgentNodeRef.current(id)
                }
              : undefined
          }
        />
      ),
      taskNode: ({ data, id }: { data: TerminalNodeData; id: string }) => {
        if (!data.task) {
          return null
        }

        return (
          <TaskNode
            title={data.title}
            requirement={data.task.requirement}
            status={data.task.status}
            width={data.width}
            height={data.height}
            onClose={() => {
              void closeNodeRef.current(id)
            }}
            onRunAgent={() => {
              void runTaskAgentRef.current(id)
            }}
            onStatusChange={status => {
              updateTaskStatusRef.current(id, status)
            }}
          />
        )
      },
    }),
    [],
  )

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      const flowPosition = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
      })
    },
    [reactFlow],
  )

  const createTerminalNode = useCallback(async () => {
    if (!contextMenu) {
      return
    }

    const anchor: Point = {
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    }

    setContextMenu(null)

    const spawned = await window.coveApi.pty.spawn({
      cwd: workspacePath,
      cols: 80,
      rows: 24,
    })

    await createNodeForSession({
      sessionId: spawned.sessionId,
      title: `terminal-${nodesRef.current.length + 1}`,
      anchor,
      kind: 'terminal',
    })
  }, [contextMenu, createNodeForSession, workspacePath])

  const openTaskCreator = useCallback(() => {
    if (!contextMenu) {
      return
    }

    setTaskCreator({
      anchor: {
        x: contextMenu.flowX,
        y: contextMenu.flowY,
      },
      title: '',
      requirement: '',
      autoGenerateTitle: true,
      isGeneratingTitle: false,
      isCreating: false,
      error: null,
    })

    setContextMenu(null)
  }, [contextMenu])

  const closeTaskCreator = useCallback(() => {
    setTaskCreator(prev => {
      if (!prev || prev.isCreating || prev.isGeneratingTitle) {
        return prev
      }

      return null
    })
  }, [])

  const generateTaskTitle = useCallback(async () => {
    if (!taskCreator) {
      return
    }

    const requirement = taskCreator.requirement.trim()
    if (requirement.length === 0) {
      setTaskCreator(prev =>
        prev
          ? {
              ...prev,
              error: '任务要求不能为空。',
            }
          : prev,
      )
      return
    }

    setTaskCreator(prev =>
      prev
        ? {
            ...prev,
            isGeneratingTitle: true,
            error: null,
          }
        : prev,
    )

    try {
      const nextTitle = await suggestTaskTitle(requirement)
      setTaskCreator(prev =>
        prev
          ? {
              ...prev,
              title: nextTitle,
              isGeneratingTitle: false,
              error: null,
            }
          : prev,
      )
    } catch (error) {
      setTaskCreator(prev =>
        prev
          ? {
              ...prev,
              isGeneratingTitle: false,
              error: `自动命名失败：${toErrorMessage(error)}`,
            }
          : prev,
      )
    }
  }, [suggestTaskTitle, taskCreator])

  const createTask = useCallback(async () => {
    if (!taskCreator) {
      return
    }

    const requirement = taskCreator.requirement.trim()
    let title = taskCreator.title.trim()

    if (requirement.length === 0) {
      setTaskCreator(prev =>
        prev
          ? {
              ...prev,
              error: '任务要求不能为空。',
            }
          : prev,
      )
      return
    }

    setTaskCreator(prev =>
      prev
        ? {
            ...prev,
            isCreating: true,
            error: null,
          }
        : prev,
    )

    let autoGeneratedTitle = false

    try {
      if (title.length === 0) {
        if (!taskCreator.autoGenerateTitle) {
          setTaskCreator(prev =>
            prev
              ? {
                  ...prev,
                  isCreating: false,
                  error: '请输入任务名称或开启自动命名。',
                }
              : prev,
          )
          return
        }

        title = await suggestTaskTitle(requirement)
        autoGeneratedTitle = true
      }

      const created = createTaskNode(taskCreator.anchor, title, requirement, autoGeneratedTitle)

      if (!created) {
        setTaskCreator(prev =>
          prev
            ? {
                ...prev,
                isCreating: false,
                error: '任务节点无法放置，请先整理画布后重试。',
              }
            : prev,
        )
        return
      }

      setTaskCreator(null)
    } catch (error) {
      setTaskCreator(prev =>
        prev
          ? {
              ...prev,
              isCreating: false,
              error: `创建任务失败：${toErrorMessage(error)}`,
            }
          : prev,
      )
    }
  }, [createTaskNode, suggestTaskTitle, taskCreator])

  const openAgentLauncher = useCallback(() => {
    if (!contextMenu) {
      return
    }

    const anchor: Point = {
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    }

    const initialProvider = agentSettings.defaultProvider
    const defaultModel = resolveAgentModel(agentSettings, initialProvider) ?? ''

    setContextMenu(null)
    setAgentLauncher({
      anchor,
      provider: initialProvider,
      prompt: '',
      model: defaultModel,
      directoryMode: 'workspace',
      customDirectory: toSuggestedWorktreePath(workspacePath, initialProvider),
      shouldCreateDirectory: true,
      isLaunching: false,
      error: null,
    })
  }, [agentSettings, contextMenu, workspacePath])

  const closeAgentLauncher = useCallback(() => {
    setAgentLauncher(prev => {
      if (!prev || prev.isLaunching) {
        return prev
      }

      return null
    })
  }, [])

  const launchAgentNode = useCallback(async () => {
    if (!agentLauncher) {
      return
    }

    const normalizedPrompt = agentLauncher.prompt.trim()
    if (normalizedPrompt.length === 0) {
      setAgentLauncher(prev =>
        prev
          ? {
              ...prev,
              error: '任务提示词不能为空。',
            }
          : prev,
      )
      return
    }

    const normalizedModel = agentLauncher.model.trim()

    const executionDirectory =
      agentLauncher.directoryMode === 'workspace'
        ? workspacePath
        : normalizeDirectoryPath(workspacePath, agentLauncher.customDirectory)

    if (executionDirectory.trim().length === 0) {
      setAgentLauncher(prev =>
        prev
          ? {
              ...prev,
              error: '请填写有效的执行目录。',
            }
          : prev,
      )
      return
    }

    setAgentLauncher(prev =>
      prev
        ? {
            ...prev,
            isLaunching: true,
            error: null,
          }
        : prev,
    )

    try {
      if (agentLauncher.directoryMode === 'custom' && agentLauncher.shouldCreateDirectory) {
        await window.coveApi.workspace.ensureDirectory({ path: executionDirectory })
      }

      const launched = await window.coveApi.agent.launch({
        provider: agentLauncher.provider,
        cwd: executionDirectory,
        prompt: normalizedPrompt,
        mode: 'new',
        model: normalizedModel.length > 0 ? normalizedModel : null,
        cols: 80,
        rows: 24,
      })

      const modelLabel =
        launched.effectiveModel ?? (normalizedModel.length > 0 ? normalizedModel : null)
      const agentData: AgentNodeData = {
        provider: agentLauncher.provider,
        prompt: normalizedPrompt,
        model: normalizedModel.length > 0 ? normalizedModel : null,
        effectiveModel: launched.effectiveModel,
        launchMode: launched.launchMode,
        resumeSessionId: launched.resumeSessionId,
        executionDirectory,
        directoryMode: agentLauncher.directoryMode,
        customDirectory:
          agentLauncher.directoryMode === 'custom' ? agentLauncher.customDirectory.trim() : null,
        shouldCreateDirectory: agentLauncher.shouldCreateDirectory,
        taskId: null,
      }

      const created = await createNodeForSession({
        sessionId: launched.sessionId,
        title: buildAgentNodeTitle(agentLauncher.provider, modelLabel),
        anchor: agentLauncher.anchor,
        kind: 'agent',
        agent: agentData,
      })

      if (!created) {
        setAgentLauncher(prev =>
          prev
            ? {
                ...prev,
                isLaunching: false,
                error: '终端窗口无法放置，请先整理画布后重试。',
              }
            : prev,
        )
        return
      }

      setAgentLauncher(null)
    } catch (error) {
      setAgentLauncher(prev =>
        prev
          ? {
              ...prev,
              isLaunching: false,
              error: `Agent 启动失败：${toErrorMessage(error)}`,
            }
          : prev,
      )
    }
  }, [agentLauncher, buildAgentNodeTitle, createNodeForSession, workspacePath])

  const applyChanges = useCallback(
    (changes: NodeChange<TerminalNodeData>[]) => {
      if (!changes.length) {
        return
      }

      const currentNodes = nodesRef.current
      const removedIds = new Set(
        changes.filter(change => change.type === 'remove').map(change => change.id),
      )

      if (removedIds.size > 0) {
        currentNodes.forEach(node => {
          if (!removedIds.has(node.id)) {
            return
          }

          if (node.data.sessionId.length > 0) {
            void window.coveApi.pty.kill({ sessionId: node.data.sessionId })
          }
        })
      }

      const survivingNodes = currentNodes.filter(node => !removedIds.has(node.id))
      const nonRemoveChanges = changes.filter(change => change.type !== 'remove')

      let nextNodes = applyNodeChanges(nonRemoveChanges, survivingNodes)

      const settledPositionChanges = changes.filter(
        change =>
          change.type === 'position' &&
          !change.dragging &&
          change.position !== undefined &&
          !removedIds.has(change.id),
      )

      if (settledPositionChanges.length > 0) {
        nextNodes = nextNodes.map(node => {
          const settledChange = settledPositionChanges.find(change => change.id === node.id)
          if (!settledChange || !settledChange.position) {
            return node
          }

          const resolved = normalizePosition(node.id, settledChange.position, {
            width: node.data.width,
            height: node.data.height,
          })

          return {
            ...node,
            position: resolved,
          }
        })
      }

      const positionChanges = changes.filter(change => change.type === 'position')
      if (positionChanges.length > 0) {
        isNodeDraggingRef.current = positionChanges.some(change => change.dragging)
      }

      if (!isNodeDraggingRef.current) {
        nextNodes = applyPendingScrollbacks(nextNodes)
      }

      const shouldSyncLayout = changes.some(change => {
        if (change.type === 'remove') {
          return true
        }

        if (change.type === 'position') {
          return !change.dragging
        }

        return change.type !== 'select'
      })

      nodesRef.current = nextNodes
      onNodesChange(nextNodes)
      if (shouldSyncLayout) {
        window.dispatchEvent(new Event('cove:terminal-layout-sync'))
      }
    },
    [applyPendingScrollbacks, normalizePosition, onNodesChange],
  )

  const launcherModelOptions = useMemo(() => {
    if (!agentLauncher) {
      return []
    }

    const provider = agentLauncher.provider
    const providerOptions = agentSettings.customModelOptionsByProvider[provider] ?? []
    const defaultModel = resolveAgentModel(agentSettings, provider)

    return [
      ...new Set([...providerOptions, defaultModel ?? '', agentLauncher.model].filter(Boolean)),
    ]
  }, [agentLauncher, agentSettings])

  const taskTitleProviderLabel = AGENT_PROVIDER_LABEL[resolveTaskTitleProvider(agentSettings)]
  const taskTitleModelLabel = resolveTaskTitleModel(agentSettings) ?? 'default model'

  return (
    <div ref={canvasRef} className="workspace-canvas" onClick={() => setContextMenu(null)}>
      <ReactFlow<TerminalNodeData>
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={applyChanges}
        onPaneContextMenu={handlePaneContextMenu}
        nodesDraggable
        elementsSelectable
        zoomOnScroll
        panOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} size={1} gap={24} color="#20324f" />
        <MiniMap
          pannable
          zoomable
          style={{
            background: 'rgba(7, 12, 24, 0.8)',
            border: '1px solid rgba(83, 124, 255, 0.35)',
          }}
        />
        <Controls />
      </ReactFlow>

      {contextMenu ? (
        <div
          className="workspace-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={event => {
            event.stopPropagation()
          }}
        >
          <button
            type="button"
            data-testid="workspace-context-new-terminal"
            onClick={() => {
              void createTerminalNode()
            }}
          >
            New Terminal
          </button>
          <button
            type="button"
            data-testid="workspace-context-new-task"
            onClick={() => {
              openTaskCreator()
            }}
          >
            New Task
          </button>
          <button
            type="button"
            data-testid="workspace-context-run-default-agent"
            onClick={() => {
              openAgentLauncher()
            }}
          >
            Run Agent
          </button>
        </div>
      ) : null}

      {taskCreator ? (
        <div
          className="workspace-task-creator-backdrop"
          onClick={() => {
            closeTaskCreator()
          }}
        >
          <section
            className="workspace-task-creator"
            data-testid="workspace-task-creator"
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <h3>New Task</h3>
            <p className="workspace-task-creator__meta">
              Auto-title provider: {taskTitleProviderLabel} · Model: {taskTitleModelLabel}
            </p>

            <div className="workspace-task-creator__field-row">
              <label htmlFor="workspace-task-title">Task Name (optional)</label>
              <input
                id="workspace-task-title"
                data-testid="workspace-task-title"
                value={taskCreator.title}
                disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
                placeholder="Leave empty to auto-generate"
                onChange={event => {
                  const nextValue = event.target.value
                  setTaskCreator(prev =>
                    prev
                      ? {
                          ...prev,
                          title: nextValue,
                          error: null,
                        }
                      : prev,
                  )
                }}
              />
            </div>

            <div className="workspace-task-creator__field-row">
              <label htmlFor="workspace-task-requirement">Task Requirement (Prompt to Agent)</label>
              <textarea
                id="workspace-task-requirement"
                data-testid="workspace-task-requirement"
                value={taskCreator.requirement}
                disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
                placeholder="输入任务要求..."
                onChange={event => {
                  const nextValue = event.target.value
                  setTaskCreator(prev =>
                    prev
                      ? {
                          ...prev,
                          requirement: nextValue,
                          error: null,
                        }
                      : prev,
                  )
                }}
              />
            </div>

            <label className="workspace-task-creator__checkbox">
              <input
                type="checkbox"
                data-testid="workspace-task-auto-generate-title"
                checked={taskCreator.autoGenerateTitle}
                disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
                onChange={event => {
                  setTaskCreator(prev =>
                    prev
                      ? {
                          ...prev,
                          autoGenerateTitle: event.target.checked,
                        }
                      : prev,
                  )
                }}
              />
              <span>Auto-generate title if empty</span>
            </label>

            {taskCreator.error ? (
              <p className="workspace-task-creator__error">{taskCreator.error}</p>
            ) : null}

            <div className="workspace-task-creator__actions">
              <button
                type="button"
                data-testid="workspace-task-create-cancel"
                disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
                onClick={() => {
                  closeTaskCreator()
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="workspace-task-generate-title"
                disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
                onClick={() => {
                  void generateTaskTitle()
                }}
              >
                {taskCreator.isGeneratingTitle ? 'Generating...' : 'Generate Title'}
              </button>
              <button
                type="button"
                data-testid="workspace-task-create-submit"
                disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
                onClick={() => {
                  void createTask()
                }}
              >
                {taskCreator.isCreating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {agentLauncher ? (
        <div
          className="workspace-agent-launcher-backdrop"
          onClick={() => {
            closeAgentLauncher()
          }}
        >
          <section
            className="workspace-agent-launcher"
            data-testid="workspace-agent-launcher"
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <h3>Run Agent</h3>

            <div className="workspace-agent-launcher__field-row">
              <label htmlFor="workspace-agent-provider">Provider</label>
              <select
                id="workspace-agent-provider"
                data-testid="workspace-agent-launch-provider"
                value={agentLauncher.provider}
                disabled={agentLauncher.isLaunching}
                onChange={event => {
                  const nextProvider = event.target.value as AgentProvider
                  setAgentLauncher(prev => {
                    if (!prev) {
                      return prev
                    }

                    return {
                      ...prev,
                      provider: nextProvider,
                      model: resolveAgentModel(agentSettings, nextProvider) ?? '',
                      customDirectory:
                        prev.directoryMode === 'custom'
                          ? toSuggestedWorktreePath(workspacePath, nextProvider)
                          : prev.customDirectory,
                      error: null,
                    }
                  })
                }}
              >
                {AGENT_PROVIDERS.map(provider => (
                  <option value={provider} key={provider}>
                    {providerLabel(provider)}
                  </option>
                ))}
              </select>
            </div>

            <div className="workspace-agent-launcher__field-row">
              <label htmlFor="workspace-agent-model">
                Model (optional, empty = follow CLI/default)
              </label>
              <input
                id="workspace-agent-model"
                data-testid="workspace-agent-launch-model"
                list="workspace-agent-model-options"
                value={agentLauncher.model}
                disabled={agentLauncher.isLaunching}
                placeholder="e.g. gpt-5.2-codex or claude-opus-4-6"
                onChange={event => {
                  const nextModel = event.target.value
                  setAgentLauncher(prev =>
                    prev
                      ? {
                          ...prev,
                          model: nextModel,
                          error: null,
                        }
                      : prev,
                  )
                }}
              />
              <datalist id="workspace-agent-model-options">
                {launcherModelOptions.map(model => (
                  <option value={model} key={model} />
                ))}
              </datalist>
            </div>

            <div className="workspace-agent-launcher__field-row">
              <label htmlFor="workspace-agent-prompt">Prompt</label>
              <textarea
                id="workspace-agent-prompt"
                data-testid="workspace-agent-launch-prompt"
                placeholder="输入任务提示词..."
                value={agentLauncher.prompt}
                disabled={agentLauncher.isLaunching}
                onChange={event => {
                  const nextPrompt = event.target.value
                  setAgentLauncher(prev =>
                    prev
                      ? {
                          ...prev,
                          prompt: nextPrompt,
                          error: null,
                        }
                      : prev,
                  )
                }}
              />
            </div>

            <div className="workspace-agent-launcher__field-row">
              <label>Execution Directory</label>
              <div className="workspace-agent-launcher__directory-mode">
                <label>
                  <input
                    type="radio"
                    name="workspace-agent-directory-mode"
                    checked={agentLauncher.directoryMode === 'workspace'}
                    disabled={agentLauncher.isLaunching}
                    onChange={() => {
                      setAgentLauncher(prev =>
                        prev
                          ? {
                              ...prev,
                              directoryMode: 'workspace',
                              error: null,
                            }
                          : prev,
                      )
                    }}
                  />
                  <span>Workspace Root</span>
                </label>

                <label>
                  <input
                    type="radio"
                    name="workspace-agent-directory-mode"
                    checked={agentLauncher.directoryMode === 'custom'}
                    disabled={agentLauncher.isLaunching}
                    onChange={() => {
                      setAgentLauncher(prev =>
                        prev
                          ? {
                              ...prev,
                              directoryMode: 'custom',
                              customDirectory:
                                prev.customDirectory.trim().length > 0
                                  ? prev.customDirectory
                                  : toSuggestedWorktreePath(workspacePath, prev.provider),
                              error: null,
                            }
                          : prev,
                      )
                    }}
                  />
                  <span>Custom / Worktree</span>
                </label>
              </div>

              {agentLauncher.directoryMode === 'custom' ? (
                <>
                  <input
                    type="text"
                    data-testid="workspace-agent-launch-custom-directory"
                    value={agentLauncher.customDirectory}
                    disabled={agentLauncher.isLaunching}
                    placeholder="/absolute/path/or/relative/path"
                    onChange={event => {
                      const nextValue = event.target.value
                      setAgentLauncher(prev =>
                        prev
                          ? {
                              ...prev,
                              customDirectory: nextValue,
                              error: null,
                            }
                          : prev,
                      )
                    }}
                  />

                  <label className="workspace-agent-launcher__checkbox">
                    <input
                      type="checkbox"
                      checked={agentLauncher.shouldCreateDirectory}
                      disabled={agentLauncher.isLaunching}
                      onChange={event => {
                        setAgentLauncher(prev =>
                          prev
                            ? {
                                ...prev,
                                shouldCreateDirectory: event.target.checked,
                              }
                            : prev,
                        )
                      }}
                    />
                    <span>Auto create directory if missing</span>
                  </label>
                </>
              ) : (
                <p className="workspace-agent-launcher__meta">{workspacePath}</p>
              )}
            </div>

            {agentLauncher.error ? (
              <p className="workspace-agent-launcher__error">{agentLauncher.error}</p>
            ) : null}

            <div className="workspace-agent-launcher__actions">
              <button
                type="button"
                data-testid="workspace-agent-launch-cancel"
                disabled={agentLauncher.isLaunching}
                onClick={() => {
                  closeAgentLauncher()
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="workspace-agent-launch-submit"
                disabled={agentLauncher.isLaunching}
                onClick={() => {
                  void launchAgentNode()
                }}
              >
                {agentLauncher.isLaunching ? 'Launching...' : 'Run'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export function WorkspaceCanvas(props: WorkspaceCanvasProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
