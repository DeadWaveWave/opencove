import type { Node } from '@xyflow/react'
import type { PrepareOrReviveSessionResult, PreparedRuntimeNodeResult } from '@shared/contracts/dto'
import type {
  PersistedWorkspaceState,
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { sanitizeWorkspaceSpaces } from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import { toRuntimeNodes } from '@contexts/workspace/presentation/renderer/utils/nodeTransform'
import { mergeScrollbackSnapshots } from '@contexts/workspace/presentation/renderer/components/terminalNode/scrollback'
import { hydrateAgentNode } from '@contexts/agent/presentation/renderer/hydrateAgentNode'

export function toShellWorkspaceState(
  workspace: PersistedWorkspaceState,
  options?: { dropRuntimeSessionIds?: boolean },
): WorkspaceState {
  const dropRuntimeSessionIds = options?.dropRuntimeSessionIds === true
  const runtimeNodes = toRuntimeNodes(workspace).map(node => {
    if (node.data.kind !== 'agent') {
      return node
    }

    return {
      ...node,
      data: {
        ...node.data,
        scrollback: null,
      },
    }
  })
  const nodes = dropRuntimeSessionIds
    ? runtimeNodes.map(node => {
        if (node.data.kind !== 'terminal' && node.data.kind !== 'agent') {
          return node
        }

        return {
          ...node,
          data: {
            ...node.data,
            sessionId: '',
          },
        }
      })
    : runtimeNodes
  const validNodeIds = new Set(nodes.map(node => node.id))
  const sanitizedSpaces = sanitizeWorkspaceSpaces(
    workspace.spaces.map(space => ({
      ...space,
      nodeIds: space.nodeIds.filter(nodeId => validNodeIds.has(nodeId)),
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
    pullRequestBaseBranchOptions: workspace.pullRequestBaseBranchOptions ?? [],
    environmentVariables: workspace.environmentVariables ?? {},
    nodes,
    viewport: {
      x: workspace.viewport.x,
      y: workspace.viewport.y,
      zoom: workspace.viewport.zoom,
    },
    isMinimapVisible: workspace.isMinimapVisible,
    spaces: sanitizedSpaces,
    activeSpaceId: hasActiveSpace ? workspace.activeSpaceId : null,
    spaceArchiveRecords: workspace.spaceArchiveRecords,
  }
}

export function requiresRuntimeHydration(node: Node<TerminalNodeData>): boolean {
  return node.data.kind === 'terminal' || node.data.kind === 'agent'
}

function mergeHydratedAgentData(
  currentAgent: TerminalNodeData['agent'],
  hydratedAgent: TerminalNodeData['agent'],
): TerminalNodeData['agent'] {
  if (!currentAgent || !hydratedAgent) {
    return hydratedAgent
  }

  return {
    ...currentAgent,
    provider: hydratedAgent.provider,
    prompt: hydratedAgent.prompt,
    model: hydratedAgent.model,
    effectiveModel: hydratedAgent.effectiveModel,
    launchMode: hydratedAgent.launchMode,
    resumeSessionId: hydratedAgent.resumeSessionId,
    resumeSessionIdVerified: hydratedAgent.resumeSessionIdVerified,
    executionDirectory:
      currentAgent.executionDirectory.trim().length > 0
        ? currentAgent.executionDirectory
        : hydratedAgent.executionDirectory,
    expectedDirectory:
      currentAgent.expectedDirectory && currentAgent.expectedDirectory.trim().length > 0
        ? currentAgent.expectedDirectory
        : hydratedAgent.expectedDirectory,
    directoryMode: currentAgent.directoryMode,
    customDirectory: currentAgent.customDirectory,
    shouldCreateDirectory: currentAgent.shouldCreateDirectory,
    taskId: currentAgent.taskId ?? hydratedAgent.taskId,
  }
}

export function mergeHydratedNode(
  currentNode: Node<TerminalNodeData>,
  hydratedNode: Node<TerminalNodeData>,
): Node<TerminalNodeData> {
  if (currentNode.id !== hydratedNode.id) {
    return currentNode
  }

  return {
    ...currentNode,
    data: {
      ...currentNode.data,
      kind: hydratedNode.data.kind,
      title: hydratedNode.data.kind === 'agent' ? hydratedNode.data.title : currentNode.data.title,
      sessionId: hydratedNode.data.sessionId,
      isLiveSessionReattach: hydratedNode.data.isLiveSessionReattach === true,
      profileId: hydratedNode.data.profileId ?? currentNode.data.profileId ?? null,
      runtimeKind: hydratedNode.data.runtimeKind ?? currentNode.data.runtimeKind,
      status: hydratedNode.data.status,
      startedAt: hydratedNode.data.startedAt,
      endedAt: hydratedNode.data.endedAt,
      exitCode: hydratedNode.data.exitCode,
      lastError: hydratedNode.data.lastError,
      scrollback: hydratedNode.data.kind === 'agent' ? null : hydratedNode.data.scrollback,
      agent: mergeHydratedAgentData(currentNode.data.agent, hydratedNode.data.agent),
      task: hydratedNode.data.task ?? currentNode.data.task,
      note: hydratedNode.data.note ?? currentNode.data.note,
    },
  }
}

export function resolveTerminalHydrationCwd(
  node: Node<TerminalNodeData>,
  workspacePath: string,
): string {
  if (node.data.kind !== 'terminal') {
    return workspacePath
  }

  const executionDirectory =
    typeof node.data.executionDirectory === 'string' ? node.data.executionDirectory.trim() : ''
  if (executionDirectory.length > 0) {
    return executionDirectory
  }

  const expectedDirectory =
    typeof node.data.expectedDirectory === 'string' ? node.data.expectedDirectory.trim() : ''
  if (expectedDirectory.length > 0) {
    return expectedDirectory
  }

  return workspacePath
}

function toHydratedRuntimeNode(
  currentNode: Node<TerminalNodeData>,
  preparedNode: PreparedRuntimeNodeResult,
): Node<TerminalNodeData> {
  return {
    ...currentNode,
    data: {
      ...currentNode.data,
      kind: preparedNode.kind,
      title: preparedNode.title,
      sessionId: preparedNode.sessionId,
      isLiveSessionReattach: preparedNode.isLiveSessionReattach === true,
      profileId: preparedNode.profileId ?? currentNode.data.profileId ?? null,
      runtimeKind: preparedNode.runtimeKind ?? currentNode.data.runtimeKind,
      status: preparedNode.status as TerminalNodeData['status'],
      startedAt: preparedNode.startedAt,
      endedAt: preparedNode.endedAt,
      exitCode: preparedNode.exitCode,
      lastError: preparedNode.lastError,
      scrollback: preparedNode.kind === 'agent' ? null : preparedNode.scrollback,
      executionDirectory: preparedNode.executionDirectory ?? currentNode.data.executionDirectory,
      expectedDirectory: preparedNode.expectedDirectory ?? currentNode.data.expectedDirectory,
      terminalGeometry: preparedNode.terminalGeometry ?? currentNode.data.terminalGeometry ?? null,
      agent:
        currentNode.data.kind === 'agent' || preparedNode.kind === 'agent'
          ? ({
              ...(currentNode.data.agent ?? {}),
              ...(preparedNode.agent ?? {}),
            } as TerminalNodeData['agent'])
          : null,
      task: currentNode.data.task,
      note: currentNode.data.note,
      image: currentNode.data.image,
      document: currentNode.data.document,
      website: currentNode.data.website,
    },
  }
}

async function hydrateRuntimeNodeLocally({
  node,
  workspacePath,
  agentSettings,
}: {
  node: Node<TerminalNodeData>
  workspacePath: string
  agentSettings: AgentSettings
}): Promise<Node<TerminalNodeData>> {
  const existingSessionId =
    typeof node.data.sessionId === 'string' ? node.data.sessionId.trim() : ''
  if (existingSessionId.length > 0) {
    try {
      const snapshot = await window.opencoveApi.pty.snapshot({ sessionId: existingSessionId })
      const liveScrollback = typeof snapshot?.data === 'string' ? snapshot.data : ''
      return {
        ...node,
        data: {
          ...node.data,
          isLiveSessionReattach: true,
          scrollback:
            node.data.kind === 'agent'
              ? null
              : mergeScrollbackSnapshots(node.data.scrollback ?? '', liveScrollback),
        },
      }
    } catch {
      // fall through to runtime recovery
    }
  }

  if (node.data.kind === 'agent' && node.data.agent) {
    const hydratedAgentNode = await hydrateAgentNode({
      node,
      workspacePath,
      agentSettings,
    })

    return {
      ...hydratedAgentNode,
      data: {
        ...hydratedAgentNode.data,
        isLiveSessionReattach: false,
      },
    }
  }

  if (node.data.kind !== 'terminal') {
    return node
  }

  try {
    const spawned = await window.opencoveApi.pty.spawn({
      cwd: resolveTerminalHydrationCwd(node, workspacePath),
      profileId: node.data.profileId ?? agentSettings.defaultTerminalProfileId ?? undefined,
      cols: 80,
      rows: 24,
    })

    return {
      ...node,
      data: {
        ...node.data,
        sessionId: spawned.sessionId,
        isLiveSessionReattach: false,
        profileId: spawned.profileId,
        runtimeKind: spawned.runtimeKind,
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
  } catch {
    return {
      ...node,
      data: {
        ...node.data,
        isLiveSessionReattach: false,
      },
    }
  }
}

export async function prepareWorkspaceRuntimeNodes({
  workspace,
  agentSettings,
  nodeIds,
  workerOnly,
}: {
  workspace: PersistedWorkspaceState
  agentSettings: AgentSettings
  nodeIds?: string[] | null
  workerOnly?: boolean
}): Promise<Node<TerminalNodeData>[]> {
  const runtimeNodes = toRuntimeNodes(workspace)
    .filter(requiresRuntimeHydration)
    .filter(node => !nodeIds || nodeIds.includes(node.id))

  if (runtimeNodes.length === 0) {
    return []
  }

  const preparedById = new Map<string, Node<TerminalNodeData>>()
  const controlSurfaceInvoke = window.opencoveApi?.controlSurface?.invoke
  const shouldRequireWorker = workerOnly ?? typeof controlSurfaceInvoke === 'function'

  if (typeof controlSurfaceInvoke === 'function') {
    try {
      const prepared = await controlSurfaceInvoke<PrepareOrReviveSessionResult>({
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: {
          workspaceId: workspace.id,
          nodeIds: runtimeNodes.map(node => node.id),
        },
      })

      for (const preparedNode of prepared.nodes ?? []) {
        const currentNode = runtimeNodes.find(node => node.id === preparedNode.nodeId)
        if (!currentNode) {
          continue
        }

        preparedById.set(currentNode.id, toHydratedRuntimeNode(currentNode, preparedNode))
      }
    } catch {
      if (shouldRequireWorker) {
        return []
      }

      // Fall back to the legacy local hydrate path when the worker contract is unavailable.
    }
  }

  if (shouldRequireWorker) {
    return runtimeNodes
      .map(node => preparedById.get(node.id) ?? node)
      .filter(node => preparedById.has(node.id))
  }

  if (preparedById.size === runtimeNodes.length) {
    return runtimeNodes.map(node => preparedById.get(node.id) ?? node)
  }

  return await Promise.all(
    runtimeNodes.map(async node => {
      const preparedNode = preparedById.get(node.id)
      if (preparedNode) {
        return preparedNode
      }

      return await hydrateRuntimeNodeLocally({
        node,
        workspacePath: workspace.path,
        agentSettings,
      })
    }),
  )
}

export async function hydrateRuntimeNode({
  node,
  workspacePath,
  agentSettings,
}: {
  node: Node<TerminalNodeData>
  workspacePath: string
  agentSettings: AgentSettings
}): Promise<Node<TerminalNodeData>> {
  return await hydrateRuntimeNodeLocally({ node, workspacePath, agentSettings })
}
