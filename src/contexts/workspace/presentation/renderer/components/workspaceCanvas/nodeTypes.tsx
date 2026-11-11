import { memo, type FunctionComponent } from 'react'
import {
  useWorkspaceCanvasNodeTypeParameters,
  type WorkspaceCanvasNodeTypesParams,
} from './nodeTypes.context'
import { WorkspaceCanvasDocumentNodeType } from './nodeTypes.document'
import { WorkspaceCanvasFolderNodeType } from './nodeTypes.folder'
import { resolveFilesystemNodeMountId } from './filesystemNodeBinding'
import { WorkspaceCanvasImageNodeType } from './nodeTypes.image'
import { WorkspaceCanvasNoteNodeType } from './nodeTypes.note'
import { WorkspaceCanvasRoleNodeType } from './nodeTypes.role'
import { WorkspaceCanvasTaskNodeType } from './nodeTypes.task'
import { WorkspaceCanvasTerminalNodeType } from './nodeTypes.terminal'
import { WorkspaceCanvasWebsiteNodeType } from './nodeTypes.website'
import { WorkspaceCanvasPluginNodeType } from './nodeTypes.plugin'
import { useNodePosition } from './nodePosition'
import type { WorkspaceCanvasNodeTypeProps } from './nodeTypes.types'
import { useTerminalDisplayAlignment } from './TerminalDisplayAlignmentContext'
import { WindowCollapsePresentation } from './collapse/WindowCollapsePresentation'
import { useWindowNodeCommitProbe } from '../shared/windowCommitProbe'

function createNodeTypes(): Record<string, FunctionComponent<WorkspaceCanvasNodeTypeProps>> {
  const TaskNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const parameters = useWorkspaceCanvasNodeTypeParameters()
    const nodePosition = useNodePosition(id)

    return (
      <WorkspaceCanvasTaskNodeType
        data={data}
        id={id}
        nodePosition={nodePosition}
        spacesRef={parameters.spacesRef}
        workspacePath={parameters.workspacePath}
        selectNode={parameters.selectNode}
        resizeNodeRef={parameters.resizeNodeRef}
        normalizeViewportForTerminalInteractionRef={
          parameters.normalizeViewportForTerminalInteractionRef
        }
        requestNodeDeleteRef={parameters.requestNodeDeleteRef}
        openTaskEditorRef={parameters.openTaskEditorRef}
        quickUpdateTaskTitleRef={parameters.quickUpdateTaskTitleRef}
        quickUpdateTaskRequirementRef={parameters.quickUpdateTaskRequirementRef}
        runTaskAgentRef={parameters.runTaskAgentRef}
        resumeTaskAgentSessionRef={parameters.resumeTaskAgentSessionRef}
        removeTaskAgentSessionRecordRef={parameters.removeTaskAgentSessionRecordRef}
        updateTaskStatusRef={parameters.updateTaskStatusRef}
      />
    )
  }

  const ImageNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const parameters = useWorkspaceCanvasNodeTypeParameters()
    const nodePosition = useNodePosition(id)
    return (
      <WorkspaceCanvasImageNodeType
        data={data}
        id={id}
        nodePosition={nodePosition}
        selectNode={parameters.selectNode}
        closeNodeRef={parameters.closeNodeRef}
        resizeNodeRef={parameters.resizeNodeRef}
        normalizeViewportForTerminalInteractionRef={
          parameters.normalizeViewportForTerminalInteractionRef
        }
      />
    )
  }

  const FilesystemNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const parameters = useWorkspaceCanvasNodeTypeParameters()
    const nodePosition = useNodePosition(id)
    const targetMountId = resolveFilesystemNodeMountId(id, data, parameters.spacesRef.current)
    const Component =
      data.kind === 'folder' ? WorkspaceCanvasFolderNodeType : WorkspaceCanvasDocumentNodeType
    return (
      <Component
        data={data}
        id={id}
        nodePosition={nodePosition}
        mountId={targetMountId}
        selectNode={parameters.selectNode}
        clearNodeSelectionRef={parameters.clearNodeSelectionRef}
        closeNodeRef={parameters.closeNodeRef}
        resizeNodeRef={parameters.resizeNodeRef}
        normalizeViewportForTerminalInteractionRef={
          parameters.normalizeViewportForTerminalInteractionRef
        }
      />
    )
  }

  const WebsiteNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const parameters = useWorkspaceCanvasNodeTypeParameters()
    const nodePosition = useNodePosition(id)
    return (
      <WorkspaceCanvasWebsiteNodeType
        data={data}
        id={id}
        nodePosition={nodePosition}
        selectNode={parameters.selectNode}
        closeNodeRef={parameters.closeNodeRef}
        resizeNodeRef={parameters.resizeNodeRef}
        normalizeViewportForTerminalInteractionRef={
          parameters.normalizeViewportForTerminalInteractionRef
        }
        updateWebsiteUrlRef={parameters.updateWebsiteUrlRef}
        setWebsitePinnedRef={parameters.setWebsitePinnedRef}
        setWebsiteSessionRef={parameters.setWebsiteSessionRef}
        setWebsiteModeRef={parameters.setWebsiteModeRef}
        setWebsiteFullscreenRef={parameters.setWebsiteFullscreenRef}
        browserDefaultMode={parameters.browserDefaultMode}
        browserSearchEngine={parameters.browserSearchEngine}
      />
    )
  }

  const TerminalNodeType = ({ data, id, selected, dragging }: WorkspaceCanvasNodeTypeProps) => {
    const parameters = useWorkspaceCanvasNodeTypeParameters()
    const displayAlignment = useTerminalDisplayAlignment()
    return (
      <WorkspaceCanvasTerminalNodeType
        data={data}
        id={id}
        selected={selected}
        dragging={dragging}
        terminalFontSize={displayAlignment.terminalFontSize}
        terminalFontFamily={displayAlignment.terminalFontFamily}
        terminalTransparentBackground={displayAlignment.terminalTransparentBackground}
        terminalDisplayCalibration={displayAlignment.terminalDisplayCalibration}
        selectNode={parameters.selectNode}
        closeNodeRef={parameters.closeNodeRef}
        resizeNodeRef={parameters.resizeNodeRef}
        copyAgentLastMessageRef={parameters.copyAgentLastMessageRef}
        reloadAgentSessionRef={parameters.reloadAgentSessionRef}
        listAgentSessionsRef={parameters.listAgentSessionsRef}
        switchAgentSessionRef={parameters.switchAgentSessionRef}
        updateNodeScrollbackRef={parameters.updateNodeScrollbackRef}
        normalizeViewportForTerminalInteractionRef={
          parameters.normalizeViewportForTerminalInteractionRef
        }
        updateTerminalTitleRef={parameters.updateTerminalTitleRef}
        clearTerminalAgentOverlayRef={parameters.clearTerminalAgentOverlayRef}
        renameTerminalTitleRef={parameters.renameTerminalTitleRef}
      />
    )
  }

  const nodeTypes = {
    terminalNode: TerminalNodeType,
    noteNode: function NoteNodeType({ data, id }: WorkspaceCanvasNodeTypeProps) {
      const parameters = useWorkspaceCanvasNodeTypeParameters()
      return (
        <WorkspaceCanvasNoteNodeType
          data={data}
          id={id}
          selectNode={parameters.selectNode}
          clearNodeSelectionRef={parameters.clearNodeSelectionRef}
          closeNodeRef={parameters.closeNodeRef}
          resizeNodeRef={parameters.resizeNodeRef}
          updateNoteTextRef={parameters.updateNoteTextRef}
          renameNoteTitleRef={parameters.renameNoteTitleRef}
          convertNoteToTask={parameters.convertNoteToTask}
          setNodeLabelColorOverride={parameters.setNodeLabelColorOverride}
          normalizeViewportForTerminalInteractionRef={
            parameters.normalizeViewportForTerminalInteractionRef
          }
          onShowMessage={parameters.onShowMessage}
        />
      )
    },
    documentNode: FilesystemNodeType,
    folderNode: FilesystemNodeType,
    websiteNode: WebsiteNodeType,
    pluginNode: function PluginNodeType({ data, id }: WorkspaceCanvasNodeTypeProps) {
      const parameters = useWorkspaceCanvasNodeTypeParameters()
      return (
        <WorkspaceCanvasPluginNodeType
          data={data}
          id={id}
          closeNodeRef={parameters.closeNodeRef}
          resizeNodeRef={parameters.resizeNodeRef}
          selectNode={parameters.selectNode}
          normalizeViewportForTerminalInteractionRef={
            parameters.normalizeViewportForTerminalInteractionRef
          }
        />
      )
    },
    imageNode: ImageNodeType,
    roleNode: function RoleNodeType({ data, id }: WorkspaceCanvasNodeTypeProps) {
      const parameters = useWorkspaceCanvasNodeTypeParameters()
      return (
        <WorkspaceCanvasRoleNodeType
          data={data}
          id={id}
          selectNode={parameters.selectNode}
          requestNodeDeleteRef={parameters.requestNodeDeleteRef}
          resizeNodeRef={parameters.resizeNodeRef}
          updateRoleProviderRef={parameters.updateRoleProviderRef}
          updateRoleInputRef={parameters.updateRoleInputRef}
          runRoleRef={parameters.runRoleRef}
          normalizeViewportForTerminalInteractionRef={
            parameters.normalizeViewportForTerminalInteractionRef
          }
          agentProviderOrder={parameters.agentProviderOrder}
          defaultProvider={parameters.defaultProvider}
        />
      )
    },
    taskNode: TaskNodeType,
  }
  return Object.fromEntries(
    Object.entries(nodeTypes).map(([type, NodeComponent]) => [
      type,
      memo((props: WorkspaceCanvasNodeTypeProps) => {
        const parameters = useWorkspaceCanvasNodeTypeParameters()
        useWindowNodeCommitProbe(props)
        return (
          <WindowCollapsePresentation
            id={props.id}
            data={props.data}
            onToggleSelection={() => parameters.selectNode(props.id, { toggle: true })}
            onSelect={() => parameters.selectNode(props.id)}
          >
            <NodeComponent {...props} />
          </WindowCollapsePresentation>
        )
      }),
    ]),
  )
}
// Component types are lifetime identities. Context supplies current commands and preferences.
const nodeTypes = createNodeTypes()
export function useWorkspaceCanvasNodeTypes(parameters: WorkspaceCanvasNodeTypesParams) {
  return { nodeTypes, nodeTypesParameters: parameters }
}
