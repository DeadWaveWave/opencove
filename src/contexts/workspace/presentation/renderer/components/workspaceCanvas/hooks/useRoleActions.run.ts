import { assertProviderInitialPrompt } from '@contexts/agent/domain/providerInitialPromptPolicy'
import type { Node } from '@xyflow/react'
import type { TranslateFn } from '@app/renderer/i18n'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import {
  resolveAgentModel,
  resolveSelectableAgentProvider,
  type AgentProvider,
  type AgentSettings,
  type ProjectRoleDefinition,
} from '@contexts/settings/domain/agentSettings'
import type { RoleNodeData, TerminalNodeData } from '../../../types'
import { resolveLaunchedAgentResumeBinding } from '../../../utils/agentResumeBinding'
import { toErrorMessage } from '../helpers'
import type { CreateNodeInput, ShowWorkspaceCanvasMessage } from '../types'
import { resolveDefaultAgentLaunchGeometry } from './agentLaunchGeometry'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'
import { composeProjectRolePrompt } from './useRolePrompt'
import type { CanvasDocumentCommands } from '../../../store/canvasStoreContext'
import type { WorkspaceDocument } from '../../../store/workspaceDocument'
import type { CanvasNodeWriter } from './useCanvasNodeWriter'
import {
  buildMergedAgentLaunchEnv,
  launchWorkspaceAgentSession,
  resolveAgentExecutableOverride,
  resolveWorkspaceAgentLaunchBinding,
} from './useWorkspaceAgentLaunch.shared'

type UpdateNodes = CanvasNodeWriter['updateNodes']

export interface RoleRunActionContext {
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  agentSettings: AgentSettings
  projectRoles: ProjectRoleDefinition[]
  /**
   * The document reader of the render that started the run: it keeps reading the workspace that
   * started it, whichever workspace is shown by the time the run awaits.
   */
  readDocument: () => WorkspaceDocument
  /**
   * The writer of the render that started the run, which writes the workspace that started it.
   * A plain function takes it explicitly (S7, Decision 8).
   */
  updateNodes: UpdateNodes
  updateCanvasDocument: CanvasNodeWriter['updateCanvasDocument']
  updateSpaces: CanvasDocumentCommands['updateSpaces']
  onShowMessage?: ShowWorkspaceCanvasMessage
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  updateRoleInput: (nodeId: string, input: string) => void
  appendRoleRunRecord: (
    nodeId: string,
    next: {
      linkedAgentNodeId: string | null
      record: RoleNodeData['runHistory'][number]
    },
  ) => void
  buildAgentNodeTitle: (provider: AgentProvider, label: string | null) => string
  t: TranslateFn
}

export function resolveNodeRoleDefinition(
  roleNode: Node<TerminalNodeData>,
  roles: ProjectRoleDefinition[],
): ProjectRoleDefinition | null {
  const roleId = roleNode.data.kind === 'role' ? roleNode.data.role?.roleId : null
  if (!roleId) {
    return null
  }

  const fromProject = roles.find(role => role.id === roleId)
  return fromProject ? { ...fromProject } : null
}

/** `flush` requests the persistence flush on the write itself, for a caller that persists it. */
function setRoleNodeLastError({
  nodeId,
  message,
  updateNodes,
  flush,
}: {
  nodeId: string
  message: string
  updateNodes: UpdateNodes
  flush?: boolean
}): void {
  updateNodes(
    prevNodes =>
      mapNodeWhenPresent(prevNodes, nodeId, node => ({
        ...node,
        data: { ...node.data, lastError: message },
      })),
    { syncLayout: false, flush },
  )
}

/**
 * Maps the window `nodeId` names. A window that is gone by now (closed during the run) is not
 * written: the recipe returns its input, so the write does not apply, notify or flush.
 */
function mapNodeWhenPresent(
  nodes: Node<TerminalNodeData>[],
  nodeId: string,
  map: (node: Node<TerminalNodeData>) => Node<TerminalNodeData>,
): Node<TerminalNodeData>[] {
  return nodes.some(node => node.id === nodeId)
    ? nodes.map(node => (node.id === nodeId ? map(node) : node))
    : nodes
}

export async function runRoleNodeAction(
  nodeId: string,
  inputOverride: string | undefined,
  context: RoleRunActionContext,
): Promise<void> {
  const roleNode = context.readDocument().nodes.find(node => node.id === nodeId)
  if (!roleNode || roleNode.data.kind !== 'role' || !roleNode.data.role) {
    return
  }

  const input = typeof inputOverride === 'string' ? inputOverride : roleNode.data.role.input
  if (input !== roleNode.data.role.input) {
    context.updateRoleInput(nodeId, input)
  }

  const role = resolveNodeRoleDefinition(roleNode, context.projectRoles)
  if (!role || role.promptTemplate.trim().length === 0) {
    setRoleNodeLastError({
      nodeId,
      message: context.t('roleNode.missingRoleDefinition'),
      updateNodes: context.updateNodes,
      flush: true,
    })
    return
  }

  const provider = resolveSelectableAgentProvider(
    roleNode.data.role.selectedProvider ?? context.agentSettings.defaultProvider,
  )
  const model = resolveAgentModel(context.agentSettings, provider)
  const executablePathOverride = resolveAgentExecutableOverride(context.agentSettings, provider)
  const mergedEnv = buildMergedAgentLaunchEnv(
    context.agentSettings,
    provider,
    context.environmentVariables,
  )
  const prompt = composeProjectRolePrompt({ role, input })
  try {
    assertProviderInitialPrompt(provider, prompt)
  } catch (error) {
    setRoleNodeLastError({
      nodeId,
      message: toErrorMessage(error),
      updateNodes: context.updateNodes,
    })
    return
  }
  const owningSpace =
    context.readDocument().spaces.find(space => space.nodeIds.includes(nodeId)) ?? null
  const initialBinding = await resolveWorkspaceAgentLaunchBinding({
    workspaceId: context.workspaceId,
    workspacePath: context.workspacePath,
    currentMountId: owningSpace?.targetMountId ?? null,
    executionDirectory: resolveSpaceWorkingDirectory(owningSpace, context.workspacePath),
    targetSpace: owningSpace,
    updateSpaces: context.updateSpaces,
  })
  const launchGeometry = resolveDefaultAgentLaunchGeometry({
    bucket: context.agentSettings.standardWindowSizeBucket,
    provider,
    terminalFontSize: context.agentSettings.terminalFontSize,
  })

  const agentNodeId = crypto.randomUUID()
  try {
    const launched = await launchWorkspaceAgentSession({
      canvasNodeId: agentNodeId,
      workspaceId: context.workspaceId,
      spaceId: owningSpace?.id,
      mountId: initialBinding.mountId,
      workspacePath: context.workspacePath,
      executionDirectory: initialBinding.executionDirectory,
      prompt,
      provider,
      mode: 'new',
      model,
      executablePathOverride,
      mergedEnv,
      agentSettings: context.agentSettings,
      launchGeometry,
      retryResolveMountBinding: async failedMountId => {
        const nextBinding = await resolveWorkspaceAgentLaunchBinding({
          workspaceId: context.workspaceId,
          workspacePath: context.workspacePath,
          currentMountId: null,
          executionDirectory: initialBinding.executionDirectory,
          targetSpace: owningSpace,
          updateSpaces: context.updateSpaces,
        })
        return nextBinding.mountId && nextBinding.mountId !== failedMountId ? nextBinding : null
      },
    })

    const createdAgentNode = await context.createNodeForSession({
      nodeId: agentNodeId,
      sessionId: launched.sessionId,
      ...(launched.managedClaudeLifecycle
        ? { managedClaudeLifecycle: launched.managedClaudeLifecycle }
        : {}),
      profileId: launched.profileId,
      runtimeKind: launched.runtimeKind,
      terminalGeometry: launchGeometry.terminalGeometry,
      standardWindowSizeBucket: context.agentSettings.standardWindowSizeBucket,
      workerBinding: launched.workerBinding,
      title: context.buildAgentNodeTitle(provider, role.name),
      anchor: {
        x: roleNode.position.x + roleNode.data.width + 48,
        y: roleNode.position.y,
      },
      kind: 'agent',
      placement: {
        targetSpaceRect: owningSpace?.rect ?? null,
        preferredDirection: 'right',
      },
      agent: {
        provider,
        prompt,
        model,
        effectiveModel: launched.effectiveModel,
        launchMode: 'new',
        ...resolveLaunchedAgentResumeBinding(provider, 'new', launched.resumeSessionId),
        executionDirectory: launched.executionDirectory,
        expectedDirectory: launched.executionDirectory,
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
    })

    if (!createdAgentNode) {
      return
    }

    if (owningSpace) {
      assignNodeToSpaceAndExpand({
        workspaceId: context.workspaceId,
        createdNodeId: createdAgentNode.id,
        targetSpaceId: owningSpace.id,
        updateCanvasDocument: context.updateCanvasDocument,
      })
    }

    const now = new Date().toISOString()
    context.appendRoleRunRecord(nodeId, {
      linkedAgentNodeId: createdAgentNode.id,
      record: {
        id: crypto.randomUUID(),
        input,
        prompt,
        outputFormat: role.outputFormat,
        provider,
        agentNodeId: createdAgentNode.id,
        sessionId: launched.sessionId,
        createdAt: now,
      },
    })
    context.updateNodes(
      prevNodes =>
        mapNodeWhenPresent(prevNodes, nodeId, node => ({
          ...node,
          data: {
            ...node.data,
            title: role.name,
            lastError: null,
            role:
              node.data.kind === 'role' && node.data.role
                ? {
                    ...node.data.role,
                    roleName: role.name,
                    roleDescription: role.description,
                    promptTemplate: role.promptTemplate,
                    inputHint: role.inputHint,
                    outputFormat: role.outputFormat,
                    selectedProvider: provider,
                    input,
                    updatedAt: now,
                  }
                : node.data.role,
          },
        })),
      { syncLayout: false, flush: true },
    )
  } catch (error) {
    const message = context.t('messages.agentLaunchFailed', {
      message: toErrorMessage(error),
    })
    setRoleNodeLastError({ nodeId, message, updateNodes: context.updateNodes, flush: true })
    context.onShowMessage?.(message, 'error')
  }
}
