import { useCallback, useMemo } from 'react'
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
import type { Point, RoleNodeData, TerminalNodeData } from '../../../types'
import { resolveNodePlacementAnchorFromViewportCenter } from '../helpers'
import {
  assignNodeToSpaceAndExpand,
  findContainingSpaceByAnchor,
} from './useInteractions.spaceAssignment'
import type { CreateNodeInput, NodePlacementOptions, ShowWorkspaceCanvasMessage } from '../types'
import { resolveDefaultRoleWindowSize } from '../constants'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'
import { runRoleNodeAction } from './useRoleActions.run'
import {
  useCanvasDocumentCommands,
  useCanvasUiCommands,
  useReadCanvasUi,
} from '../../../store/canvasStoreContext'
import type { WorkspaceDocument } from '../../../store/workspaceDocument'

function toRoleNameKey(name: string): string {
  return name.trim().toLowerCase()
}

export function useWorkspaceCanvasRoleActions({
  workspaceId,
  workspacePath,
  environmentVariables,
  agentSettings,
  readAgentSettings,
  readDocument,
  onShowMessage,
  standardWindowSizeBucket,
  createRoleNode,
  createNodeForSession,
  updateRoleInput,
  appendRoleRunRecord,
  buildAgentNodeTitle,
}: {
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  /** What the menus and dialogs of the role UI render with; a role run reads `readAgentSettings`. */
  agentSettings: AgentSettings
  /** The app's settings when a role run starts (S7 of #647, Decision 2): never a render's copy. */
  readAgentSettings: () => AgentSettings
  /**
   * The document reader of the render that made these actions. The role UI makes it: this file
   * subscribes to the app store for the settings, and a file that reads the document through its
   * own reader does not also subscribe to that store.
   */
  readDocument: () => WorkspaceDocument
  onShowMessage?: ShowWorkspaceCanvasMessage
  standardWindowSizeBucket: StandardWindowSizeBucket
  createRoleNode: (
    anchor: Point,
    role: ProjectRoleDefinition,
    placement?: NodePlacementOptions & { selectedProvider?: AgentProvider | null },
  ) => Node<TerminalNodeData> | null
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
}): {
  /** The role family's `run`: starts a role node's agent (S7 of #647). */
  runRole: (nodeId: string, inputOverride?: string) => Promise<void>
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
  const { updateNodes, updateCanvasDocument } = useCanvasNodeWriter()

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
      const targetSpace = findContainingSpaceByAnchor(readDocument().spaces, cursorAnchor)
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
        targetSpaceId: targetSpace.id,
        updateCanvasDocument,
      })
      // The assignment is one write of the nodes and the Spaces; the flush follows it.
      documentCommands.requestPersistFlush()
      return created
    },
    [
      workspaceId,
      agentSettings.defaultProvider,
      createRoleNode,
      documentCommands,
      readDocument,
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
      updateNodes(
        prevNodes =>
          // No window of the role is left: the recipe returns its input, and nothing is written.
          !prevNodes.some(node => node.data.role?.roleId === role.id)
            ? prevNodes
            : prevNodes.map(node =>
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
      // The role definition is a setting persisted next to the document (#769): the flush is asked
      // for here, once, whether or not a window of the role was written.
      documentCommands.requestPersistFlush()
    } else {
      createRoleNodeAtFlowPoint(roleCreator.anchor, role)
      // The new role node and its Space were written by the creation above; the flush follows.
      documentCommands.requestPersistFlush()
    }
    ui.closeDialog('roleCreator')
  }, [
    createRoleNodeAtFlowPoint,
    documentCommands,
    projectRoles,
    readUi,
    setAgentSettings,
    t,
    ui,
    updateNodes,
    workspaceId,
  ])

  // A command: it reads the settings when the run starts, and keeps the workspace, the reader and
  // the writer of the render that made it, so a run that started in A and finishes after the switch
  // to B writes A (Decision 4).
  const runRole = useCallback(
    async (nodeId: string, inputOverride?: string): Promise<void> => {
      const settings = readAgentSettings()
      await runRoleNodeAction(nodeId, inputOverride, {
        workspaceId,
        workspacePath,
        environmentVariables,
        agentSettings: settings,
        projectRoles: settings.projectRolesByWorkspaceId[workspaceId] ?? [],
        readDocument,
        updateNodes,
        updateCanvasDocument,
        updateSpaces: documentCommands.updateSpaces,
        onShowMessage,
        createNodeForSession,
        updateRoleInput,
        appendRoleRunRecord,
        buildAgentNodeTitle,
        t,
      })
    },
    [
      appendRoleRunRecord,
      buildAgentNodeTitle,
      createNodeForSession,
      documentCommands,
      environmentVariables,
      onShowMessage,
      readAgentSettings,
      readDocument,
      t,
      updateCanvasDocument,
      updateNodes,
      updateRoleInput,
      workspaceId,
      workspacePath,
    ],
  )

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
      // The role definitions are settings; no node write comes before this flush.
      documentCommands.requestPersistFlush()
    },
    [documentCommands, readUi, setAgentSettings, ui, workspaceId],
  )

  return {
    runRole,
    openRoleCreator,
    closeRoleCreator,
    createRole,
    runProjectRoleFromContextMenu,
    openRoleEditor,
    deleteProjectRole,
  }
}
