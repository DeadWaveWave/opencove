import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TranslateFn } from '@app/renderer/i18n'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import {
  resolveAgentModel,
  type AgentProvider,
  type AgentSettings,
  type ProjectRoleDefinition,
} from '@contexts/settings/domain/agentSettings'
import type { RoleNodeData, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { clearResumeSessionBinding } from '../../../utils/agentResumeBinding'
import { toErrorMessage } from '../helpers'
import type { CreateNodeInput, ShowWorkspaceCanvasMessage } from '../types'
import { resolveDefaultAgentLaunchGeometry } from './agentLaunchGeometry'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'
import { composeProjectRolePrompt } from './useRolePrompt'
import {
  buildMergedAgentLaunchEnv,
  launchWorkspaceAgentSession,
  resolveAgentExecutableOverride,
  resolveWorkspaceAgentLaunchBinding,
} from './useWorkspaceAgentLaunch.shared'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export interface RoleRunActionContext {
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  agentSettings: AgentSettings
  projectRoles: ProjectRoleDefinition[]
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
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

function setRoleNodeLastError({
  nodeId,
  message,
  setNodes,
}: {
  nodeId: string
  message: string
  setNodes: SetNodes
}): void {
  setNodes(
    prevNodes =>
      prevNodes.map(node =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                lastError: message,
              },
            }
          : node,
      ),
    { syncLayout: false },
  )
}

export async function runRoleNodeAction(
  nodeId: string,
  inputOverride: string | undefined,
  context: RoleRunActionContext,
): Promise<void> {
  const roleNode = context.nodesRef.current.find(node => node.id === nodeId)
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
      setNodes: context.setNodes,
    })
    context.onRequestPersistFlush?.()
    return
  }

  const provider = roleNode.data.role.selectedProvider ?? context.agentSettings.defaultProvider
  const model = resolveAgentModel(context.agentSettings, provider)
  const executablePathOverride = resolveAgentExecutableOverride(context.agentSettings, provider)
  const mergedEnv = buildMergedAgentLaunchEnv(
    context.agentSettings,
    provider,
    context.environmentVariables,
  )
  const prompt = composeProjectRolePrompt({ role, input })
  const owningSpace =
    context.spacesRef.current.find(space => space.nodeIds.includes(nodeId)) ?? null
  const initialBinding = await resolveWorkspaceAgentLaunchBinding({
    workspaceId: context.workspaceId,
    workspacePath: context.workspacePath,
    currentMountId: owningSpace?.targetMountId ?? null,
    executionDirectory: resolveSpaceWorkingDirectory(owningSpace, context.workspacePath),
    targetSpace: owningSpace,
    spacesRef: context.spacesRef,
    onSpacesChange: context.onSpacesChange,
    onRequestPersistFlush: context.onRequestPersistFlush,
  })
  const launchGeometry = resolveDefaultAgentLaunchGeometry({
    bucket: context.agentSettings.standardWindowSizeBucket,
    provider,
    terminalFontSize: context.agentSettings.terminalFontSize,
  })

  try {
    const launched = await launchWorkspaceAgentSession({
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
          spacesRef: context.spacesRef,
          onSpacesChange: context.onSpacesChange,
          onRequestPersistFlush: context.onRequestPersistFlush,
        })
        return nextBinding.mountId && nextBinding.mountId !== failedMountId ? nextBinding : null
      },
    })

    const createdAgentNode = await context.createNodeForSession({
      sessionId: launched.sessionId,
      profileId: launched.profileId,
      runtimeKind: launched.runtimeKind,
      terminalGeometry: launchGeometry.terminalGeometry,
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
        ...clearResumeSessionBinding(),
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
        createdNodeId: createdAgentNode.id,
        targetSpaceId: owningSpace.id,
        spacesRef: context.spacesRef,
        nodesRef: context.nodesRef,
        setNodes: context.setNodes,
        onSpacesChange: context.onSpacesChange,
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
    context.setNodes(
      prevNodes =>
        prevNodes.map(node =>
          node.id === nodeId
            ? {
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
              }
            : node,
        ),
      { syncLayout: false },
    )
    context.onRequestPersistFlush?.()
  } catch (error) {
    const message = context.t('messages.agentLaunchFailed', {
      message: toErrorMessage(error),
    })
    setRoleNodeLastError({ nodeId, message, setNodes: context.setNodes })
    context.onRequestPersistFlush?.()
    context.onShowMessage?.(message, 'error')
  }
}
