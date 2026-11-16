import { useCallback, useLayoutEffect, useMemo, type MutableRefObject } from 'react'
import { resolvePaneNodeCreationAnchor } from './useInteractions.creationAnchor'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import {
  resolveSelectableAgentProvider,
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
import type { CreateNodeInput, NodePlacementOptions, ShowWorkspaceCanvasMessage } from '../types'
import { resolveDefaultRoleWindowSize } from '../constants'
import type { WorkspaceCanvasActionRefs } from './useActionRefs'
import { runRoleNodeAction } from './useRoleActions.run'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import {
  useCanvasDocumentCommands,
  useCanvasUiCommands,
  useReadCanvasUi,
} from '../../../store/canvasStoreContext'

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
  nodesRef,
  spacesRef,
  setNodes,
  updateCanvasDocument,
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
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  setNodes: SetNodes
  updateCanvasDocument: UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']
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
  openRoleCreator: () => void
  closeRoleCreator: () => void
  createRole: () => void
  runProjectRoleFromContextMenu: (roleId: string) => void
  openRoleEditor: (roleId: string) => void
  deleteProjectRole: (roleId: string) => void
} {
  const ui = useCanvasUiCommands()
  const readUi = useReadCanvasUi()
  const documentCommands = useCanvasDocumentCommands()

  const { t } = useTranslation()
  const setAgentSettings = useAppStore(state => state.setAgentSettings)
  const projectRoles = useMemo(
    () => agentSettings.projectRolesByWorkspaceId[workspaceId] ?? [],
    [agentSettings.projectRolesByWorkspaceId, workspaceId],
  )

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
        selectedProvider: resolveSelectableAgentProvider(agentSettings.defaultProvider),
      })

      if (!created || !targetSpace) {
        return created
      }

      assignNodeToSpaceAndExpand({
        workspaceId,
        createdNodeId: created.id,
        createdNode: created,
        targetSpaceId: targetSpace.id,
        updateCanvasDocument,
      })
      onRequestPersistFlush?.()
      return created
    },
    [
      workspaceId,
      agentSettings.defaultProvider,
      createRoleNode,
      onRequestPersistFlush,
      spacesRef,
      standardWindowSizeBucket,
      updateCanvasDocument,
    ],
  )

  const openRoleCreator = useCallback(() => {
    const contextMenu = readUi().contextMenu
    if (!contextMenu || contextMenu.kind !== 'pane') {
      return
    }

    ui.openDialog('roleCreator', {
      anchor: resolvePaneNodeCreationAnchor(contextMenu),
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
    ui.closeContextMenu()
  }, [readUi, ui])

  const closeRoleCreator = useCallback(() => {
    if (readUi().roleCreator?.isCreating) {
      return
    }

    ui.closeDialog('roleCreator')
  }, [readUi, ui])

  const createRole = useCallback(() => {
    const roleCreator = readUi().roleCreator
    if (!roleCreator) {
      return
    }

    const name = roleCreator.name.trim()
    const promptTemplate = roleCreator.promptTemplate.trim()
    if (name.length === 0) {
      ui.updateDialog('roleCreator', current => ({
        ...current,
        error: t('roleCreator.nameRequired'),
      }))
      return
    }

    if (promptTemplate.length === 0) {
      ui.updateDialog('roleCreator', current => ({
        ...current,
        error: t('roleCreator.promptRequired'),
      }))
      return
    }

    const duplicate = projectRoles.some(
      role =>
        toRoleNameKey(role.name) === toRoleNameKey(name) &&
        (roleCreator.mode !== 'edit' || role.id !== roleCreator.roleId),
    )
    if (duplicate) {
      ui.updateDialog('roleCreator', current => ({
        ...current,
        error: t('roleCreator.duplicateName'),
      }))
      return
    }

    const now = new Date().toISOString()
    const existingRole =
      roleCreator.mode === 'edit' ? projectRoles.find(role => role.id === roleCreator.roleId) : null
    if (roleCreator.mode === 'edit' && !existingRole) {
      ui.updateDialog('roleCreator', current => ({
        ...current,
        error: t('roleNode.missingRoleDefinition'),
      }))
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

    ui.updateDialog('roleCreator', current => ({ ...current, isCreating: true, error: null }))
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
    ui.closeDialog('roleCreator')
    onRequestPersistFlush?.()
  }, [
    createRoleNodeAtFlowPoint,
    onRequestPersistFlush,
    projectRoles,
    readUi,
    setAgentSettings,
    setNodes,
    t,
    ui,
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
        updateCanvasDocument,
        updateSpaces: documentCommands.updateSpaces,
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
      documentCommands,
      environmentVariables,
      nodesRef,
      onRequestPersistFlush,
      onShowMessage,
      projectRoles,
      setNodes,
      spacesRef,
      t,
      updateCanvasDocument,
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
      const contextMenu = readUi().contextMenu
      if (!contextMenu || contextMenu.kind !== 'pane') {
        return
      }

      const role = projectRoles.find(candidate => candidate.id === roleId)
      if (!role) {
        return
      }

      ui.closeContextMenu()
      createRoleNodeAtFlowPoint(resolvePaneNodeCreationAnchor(contextMenu), role)
    },
    [createRoleNodeAtFlowPoint, projectRoles, readUi, ui],
  )

  const openRoleEditor = useCallback(
    (roleId: string) => {
      const role = projectRoles.find(candidate => candidate.id === roleId)
      if (!role) {
        return
      }

      ui.closeContextMenu()
      ui.openDialog('roleCreator', {
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
    [projectRoles, ui],
  )

  const deleteProjectRole = useCallback(
    (roleId: string) => {
      ui.closeContextMenu()
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
      const roleCreator = readUi().roleCreator
      if (roleCreator?.mode === 'edit' && roleCreator.roleId === roleId) {
        ui.closeDialog('roleCreator')
      }
      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, readUi, setAgentSettings, ui, workspaceId],
  )

  return {
    openRoleCreator,
    closeRoleCreator,
    createRole,
    runProjectRoleFromContextMenu,
    openRoleEditor,
    deleteProjectRole,
  }
}
