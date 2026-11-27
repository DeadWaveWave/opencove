import { memo, useMemo, type FunctionComponent } from 'react'
import {
  useCanvasNodeCommands,
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
import { useReadCanvasDocument } from '../../store/canvasStoreContext'
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
        workspacePath={parameters.workspacePath}
      />
    )
  }

  const ImageNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const nodePosition = useNodePosition(id)
    return <WorkspaceCanvasImageNodeType data={data} id={id} nodePosition={nodePosition} />
  }

  const FilesystemNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const nodePosition = useNodePosition(id)
    const readDocument = useReadCanvasDocument()
    // Read when this renders, not subscribed: the Spaces of the store as they are now.
    const targetMountId = resolveFilesystemNodeMountId(id, data, readDocument().spaces)
    const Component =
      data.kind === 'folder' ? WorkspaceCanvasFolderNodeType : WorkspaceCanvasDocumentNodeType
    return <Component data={data} id={id} nodePosition={nodePosition} mountId={targetMountId} />
  }

  const WebsiteNodeType = ({ data, id }: WorkspaceCanvasNodeTypeProps) => {
    const parameters = useWorkspaceCanvasNodeTypeParameters()
    const nodePosition = useNodePosition(id)
    return (
      <WorkspaceCanvasWebsiteNodeType
        data={data}
        id={id}
        nodePosition={nodePosition}
        browserDefaultMode={parameters.browserDefaultMode}
        browserSearchEngine={parameters.browserSearchEngine}
      />
    )
  }

  const TerminalNodeType = ({ data, id, selected, dragging }: WorkspaceCanvasNodeTypeProps) => {
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
      />
    )
  }

  const nodeTypes = {
    terminalNode: TerminalNodeType,
    noteNode: function NoteNodeType({ data, id }: WorkspaceCanvasNodeTypeProps) {
      const parameters = useWorkspaceCanvasNodeTypeParameters()
      return (
        <WorkspaceCanvasNoteNodeType data={data} id={id} onShowMessage={parameters.onShowMessage} />
      )
    },
    documentNode: FilesystemNodeType,
    folderNode: FilesystemNodeType,
    websiteNode: WebsiteNodeType,
    pluginNode: function PluginNodeType({ data, id }: WorkspaceCanvasNodeTypeProps) {
      return <WorkspaceCanvasPluginNodeType data={data} id={id} />
    },
    imageNode: ImageNodeType,
    roleNode: function RoleNodeType({ data, id }: WorkspaceCanvasNodeTypeProps) {
      const parameters = useWorkspaceCanvasNodeTypeParameters()
      return (
        <WorkspaceCanvasRoleNodeType
          data={data}
          id={id}
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
        const windowCommands = useCanvasNodeCommands().window
        useWindowNodeCommitProbe(props)
        return (
          <WindowCollapsePresentation
            id={props.id}
            data={props.data}
            onToggleSelection={() => windowCommands.select(props.id, { toggle: true })}
            onSelect={() => windowCommands.select(props.id)}
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
export function useWorkspaceCanvasNodeTypes({
  workspacePath,
  onShowMessage,
  agentProviderOrder,
  defaultProvider,
  browserDefaultMode,
  browserSearchEngine,
  commands,
}: WorkspaceCanvasNodeTypesParams) {
  // Callers compose fresh containers on viewport renders; only the individual inputs
  // should notify node consumers. Component types remain stable independently of this cache.
  const nodeTypesParameters = useMemo<WorkspaceCanvasNodeTypesParams>(
    () => ({
      workspacePath,
      onShowMessage,
      agentProviderOrder,
      defaultProvider,
      browserDefaultMode,
      browserSearchEngine,
      commands,
    }),
    [
      workspacePath,
      onShowMessage,
      agentProviderOrder,
      defaultProvider,
      browserDefaultMode,
      browserSearchEngine,
      commands,
    ],
  )
  return { nodeTypes, nodeTypesParameters }
}
