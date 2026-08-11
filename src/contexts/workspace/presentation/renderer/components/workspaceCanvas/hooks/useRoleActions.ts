import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import {
  type AgentProvider,
  type AgentSettings,
  type ProjectRoleDefinition,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import type { Point, RoleNodeData, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveNodePlacementAnchorFromViewportCenter } from '../helpers'
import {
  assignNodeToSpaceAndExpand,
  findContainingSpaceByAnchor,
} from './useInteractions.spaceAssignment'
import type {
  ContextMenuState,
  CreateNodeInput,
  NodePlacementOptions,
  RoleCreatorState,
  ShowWorkspaceCanvasMessage,
} from '../types'
import { resolveDefaultRoleWindowSize } from '../constants'
import type { WorkspaceCanvasActionRefs } from './useActionRefs'
import { runRoleNodeAction } from './useRoleActions.run'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

function toRoleNameKey(name: string): string {
  return name.trim().toLowerCase()
}

export function useWorkspaceCanvasRoleActions({
  workspaceId,
  workspacePath,
  environmentVariables,
  agentSettings,
  contextMenu,
  setContextMenu,
  nodesRef,
  spacesRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  onShowMessage,
  standardWindowSizeBucket,
  createRoleNode,
  createNodeForSession,
  updateRoleProvider,
  updateRoleInput,
  appendRoleRunRecord,
  actionRefs,
  buildAgentNodeTitle,
}: {
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  agentSettings: AgentSettings
  contextMenu: ContextMenuState | null
  setContextMenu: (next: ContextMenuState | null) => void
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  standardWindowSizeBucket: StandardWindowSizeBucket
  createRoleNode: (
    anchor: Point,
    role: ProjectRoleDefinition,
    placement?: NodePlacementOptions & { selectedProvider?: AgentProvider | null },
  ) => Node<TerminalNodeData> | null
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  updateRoleProvider: (nodeId: string, provider: AgentProvider) => void
  updateRoleInput: (nodeId: string, input: string) => void
  appendRoleRunRecord: (
    nodeId: string,
    next: {
      linkedAgentNodeId: string | null
      record: RoleNodeData['runHistory'][number]
    },
  ) => void
  actionRefs: WorkspaceCanvasActionRefs
  buildAgentNodeTitle: (provider: AgentProvider, label: string | null) => string
}): {
  roleCreator: RoleCreatorState | null
  setRoleCreator: Dispatch<SetStateAction<RoleCreatorState | null>>
  openRoleCreator: () => void
  closeRoleCreator: () => void
  createRole: () => void
  runProjectRoleFromContextMenu: (roleId: string) => void
  openRoleEditor: (roleId: string) => void
  deleteProjectRole: (roleId: string) => void
} {
  const { t } = useTranslation()
  const setAgentSettings = useAppStore(state => state.setAgentSettings)
  const projectRoles = useMemo(
    () => agentSettings.projectRolesByWorkspaceId[workspaceId] ?? [],
    [agentSettings.projectRolesByWorkspaceId, workspaceId],
  )
  const [roleCreator, setRoleCreator] = useState<RoleCreatorState | null>(null)

  const createRoleNodeAtFlowPoint = useCallback(
    (anchor: Point, role: ProjectRoleDefinition): Node<TerminalNodeData> | null => {
      const cursorAnchor = { x: anchor.x, y: anchor.y }
      const nodeAnchor = resolveNodePlacementAnchorFromViewportCenter(
        cursorAnchor,
        resolveDefaultRoleWindowSize(standardWindowSizeBucket),
      )
      const targetSpace = findContainingSpaceByAnchor(spacesRef.current, cursorAnchor)
      const created = createRoleNode(nodeAnchor, role, {
        targetSpaceRect: targetSpace?.rect ?? null,
        selectedProvider: agentSettings.defaultProvider,
      })

      if (!created || !targetSpace) {
        return created
      }

      assignNodeToSpaceAndExpand({
        createdNodeId: created.id,
        createdNode: created,
        targetSpaceId: targetSpace.id,
        spacesRef,
        nodesRef,
        setNodes,
        onSpacesChange,
      })
      onRequestPersistFlush?.()
      return created
    },
    [
      agentSettings.defaultProvider,
      createRoleNode,
      nodesRef,
      onRequestPersistFlush,
      onSpacesChange,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
    ],
  )

  const openRoleCreator = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'pane') {
      return
    }

    setRoleCreator({
      anchor: { x: contextMenu.flowX, y: contextMenu.flowY },
      mode: 'create',
      roleId: null,
      name: '',
      description: '',
      promptTemplate: '',
      inputHint: '',
      outputFormat: '',
      isCreating: false,
      error: null,
    })
    setContextMenu(null)
  }, [contextMenu, setContextMenu])

  const closeRoleCreator = useCallback(() => {
    setRoleCreator(prev => (prev?.isCreating ? prev : null))
  }, [])

  const createRole = useCallback(() => {
    if (!roleCreator) {
      return
    }

    const name = roleCreator.name.trim()
    const promptTemplate = roleCreator.promptTemplate.trim()
    if (name.length === 0) {
      setRoleCreator(prev => (prev ? { ...prev, error: t('roleCreator.nameRequired') } : prev))
      return
    }

    if (promptTemplate.length === 0) {
      setRoleCreator(prev => (prev ? { ...prev, error: t('roleCreator.promptRequired') } : prev))
      return
    }

    const duplicate = projectRoles.some(
      role =>
        toRoleNameKey(role.name) === toRoleNameKey(name) &&
        (roleCreator.mode !== 'edit' || role.id !== roleCreator.roleId),
    )
    if (duplicate) {
      setRoleCreator(prev => (prev ? { ...prev, error: t('roleCreator.duplicateName') } : prev))
      return
    }

    const now = new Date().toISOString()
    const existingRole =
      roleCreator.mode === 'edit' ? projectRoles.find(role => role.id === roleCreator.roleId) : null
    if (roleCreator.mode === 'edit' && !existingRole) {
      setRoleCreator(prev =>
        prev ? { ...prev, error: t('roleNode.missingRoleDefinition') } : prev,
      )
      return
    }

    const role: ProjectRoleDefinition = {
      id: existingRole?.id ?? crypto.randomUUID(),
      name,
      description: roleCreator.description.trim(),
      promptTemplate,
      inputHint: roleCreator.inputHint.trim(),
      outputFormat: roleCreator.outputFormat.trim(),
      createdAt: existingRole?.createdAt ?? now,
      updatedAt: now,
    }

    setRoleCreator(prev => (prev ? { ...prev, isCreating: true, error: null } : prev))
    setAgentSettings(prev => {
      const current = prev.projectRolesByWorkspaceId[workspaceId] ?? []
      const nextRoles =
        roleCreator.mode === 'edit'
          ? current.map(candidate => (candidate.id === role.id ? role : candidate))
          : [...current, role]
      return {
        ...prev,
        projectRolesByWorkspaceId: {
          ...prev.projectRolesByWorkspaceId,
          [workspaceId]: nextRoles,
        },
      }
    })

    if (roleCreator.mode === 'edit') {
      setNodes(
        prevNodes =>
          prevNodes.map(node =>
            node.data.kind === 'role' && node.data.role?.roleId === role.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    title: role.name,
                    role: {
                      ...node.data.role,
                      roleName: role.name,
                      roleDescription: role.description,
                      promptTemplate: role.promptTemplate,
                      inputHint: role.inputHint,
                      outputFormat: role.outputFormat,
                      updatedAt: now,
                    },
                  },
                }
              : node,
          ),
        { syncLayout: false },
      )
    } else {
      createRoleNodeAtFlowPoint(roleCreator.anchor, role)
    }
    setRoleCreator(null)
    onRequestPersistFlush?.()
  }, [
    createRoleNodeAtFlowPoint,
    onRequestPersistFlush,
    projectRoles,
    roleCreator,
    setAgentSettings,
    setNodes,
    t,
    workspaceId,
  ])

  const runRoleNode = useCallback(
    async (nodeId: string, inputOverride?: string): Promise<void> => {
      await runRoleNodeAction(nodeId, inputOverride, {
        workspaceId,
        workspacePath,
        environmentVariables,
        agentSettings,
        projectRoles,
        nodesRef,
        spacesRef,
        setNodes,
        onSpacesChange,
        onRequestPersistFlush,
        onShowMessage,
        createNodeForSession,
        updateRoleInput,
        appendRoleRunRecord,
        buildAgentNodeTitle,
        t,
      })
    },
    [
      agentSettings,
      appendRoleRunRecord,
      buildAgentNodeTitle,
      createNodeForSession,
      environmentVariables,
      nodesRef,
      onRequestPersistFlush,
      onShowMessage,
      onSpacesChange,
      projectRoles,
      setNodes,
      spacesRef,
      t,
      updateRoleInput,
      workspaceId,
      workspacePath,
    ],
  )

  useLayoutEffect(() => {
    actionRefs.updateRoleProviderRef.current = updateRoleProvider
  }, [actionRefs.updateRoleProviderRef, updateRoleProvider])

  useLayoutEffect(() => {
    actionRefs.updateRoleInputRef.current = updateRoleInput
  }, [actionRefs.updateRoleInputRef, updateRoleInput])

  useLayoutEffect(() => {
    actionRefs.runRoleRef.current = runRoleNode
  }, [actionRefs.runRoleRef, runRoleNode])

  const runProjectRoleFromContextMenu = useCallback(
    (roleId: string) => {
      if (!contextMenu || contextMenu.kind !== 'pane') {
        return
      }

      const role = projectRoles.find(candidate => candidate.id === roleId)
      if (!role) {
        return
      }

      setContextMenu(null)
      createRoleNodeAtFlowPoint({ x: contextMenu.flowX, y: contextMenu.flowY }, role)
    },
    [contextMenu, createRoleNodeAtFlowPoint, projectRoles, setContextMenu],
  )

  const openRoleEditor = useCallback(
    (roleId: string) => {
      const role = projectRoles.find(candidate => candidate.id === roleId)
      if (!role) {
        return
      }

      setContextMenu(null)
      setRoleCreator({
        anchor: { x: 0, y: 0 },
        mode: 'edit',
        roleId: role.id,
        name: role.name,
        description: role.description,
        promptTemplate: role.promptTemplate,
        inputHint: role.inputHint,
        outputFormat: role.outputFormat,
        isCreating: false,
        error: null,
      })
    },
    [projectRoles, setContextMenu],
  )

  const deleteProjectRole = useCallback(
    (roleId: string) => {
      setContextMenu(null)
      setAgentSettings(prev => {
        const current = prev.projectRolesByWorkspaceId[workspaceId] ?? []
        const nextRoles = current.filter(role => role.id !== roleId)
        const nextByWorkspace = { ...prev.projectRolesByWorkspaceId }

        if (nextRoles.length > 0) {
          nextByWorkspace[workspaceId] = nextRoles
        } else {
          delete nextByWorkspace[workspaceId]
        }

        return {
          ...prev,
          projectRolesByWorkspaceId: nextByWorkspace,
        }
      })
      setRoleCreator(prev => (prev?.mode === 'edit' && prev.roleId === roleId ? null : prev))
      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, setAgentSettings, setContextMenu, workspaceId],
  )

  return {
    roleCreator,
    setRoleCreator,
    openRoleCreator,
    closeRoleCreator,
    createRole,
    runProjectRoleFromContextMenu,
    openRoleEditor,
    deleteProjectRole,
  }
}
