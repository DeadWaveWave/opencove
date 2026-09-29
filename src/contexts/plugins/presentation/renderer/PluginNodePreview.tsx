import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
} from 'react'
import {
  applyNodeChanges,
  ReactFlow,
  ReactFlowProvider,
  type NodeChange,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { GitBoardNodeView } from '@contexts/workspace/presentation/renderer/components/GitBoardNodeView'
import type { NodeFrame, TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { useNodePosition } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodePosition'
import { WindowCollapsePresentation } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WindowCollapsePresentation'
import {
  WorkspaceCollapseContext,
  type WorkspaceCollapseValue,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WorkspaceCollapseContext'
import { WindowNodeContextMenuContext } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WindowNodeContextMenuContext'
import { projectCollapsedNodes } from '@contexts/workspace/presentation/renderer/utils/canvasCollapse'
import {
  createPreviewNode,
  createPreviewSnapshot,
  COMPACT_PREVIEW_CANVAS_SIZE,
  PREVIEW_CANVAS_SIZE,
  PREVIEW_NODE_ID,
} from './pluginNodePreviewModel'
import { usePreviewViewport } from './usePreviewViewport'

type PreviewNode = Node<TerminalNodeData>
const noOp = (): void => {}
const PreviewContext = createContext({
  snapshot: createPreviewSnapshot(),
  compact: false,
  close: noOp,
  refresh: noOp,
  resize: (_frame: NodeFrame): void => {},
})

function PreviewNodeWindow({ id, data }: NodeProps<PreviewNode>): JSX.Element {
  const preview = useContext(PreviewContext)
  const position = useNodePosition(id)
  return (
    <WindowCollapsePresentation id={id} data={data}>
      <GitBoardNodeView
        id={id}
        title={data.title}
        testIdPrefix="plugin-preview"
        repoPath={preview.snapshot.status.repoPath}
        snapshot={preview.snapshot}
        position={position}
        width={data.width}
        height={data.height}
        minSize={preview.compact ? { width: 320, height: 260 } : undefined}
        onClose={preview.close}
        onResize={preview.resize}
        onRefresh={preview.refresh}
      />
    </WindowCollapsePresentation>
  )
}

const nodeTypes = { pluginPreview: PreviewNodeWindow }

function GitBoardPreview(): JSX.Element {
  const { t } = useTranslation()
  const [nodes, setNodes] = useState<PreviewNode[]>(() => [createPreviewNode()])
  const [collapsed, setCollapsed] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const { containerRef, viewport, compact } = usePreviewViewport(
    PREVIEW_CANVAS_SIZE,
    COMPACT_PREVIEW_CANVAS_SIZE,
  )
  useEffect(() => {
    setNodes(current => (current.length ? [createPreviewNode(compact)] : current))
  }, [compact])
  const reset = useCallback(() => {
    setNodes([createPreviewNode(compact)])
    setCollapsed(false)
    setRefreshed(false)
  }, [compact])
  const onNodesChange = useCallback((changes: NodeChange<PreviewNode>[]) => {
    // Measured geometry is a projection; only local gestures can move/select the sample.
    const gestures = changes.filter(
      change => change.type === 'position' || change.type === 'select',
    )
    if (gestures.length) {
      setNodes(current => applyNodeChanges(gestures, current))
    }
  }, [])
  const resize = useCallback((frame: NodeFrame) => {
    setNodes(current =>
      current.map(node => ({
        ...node,
        position: frame.position,
        data: { ...node.data, ...frame.size },
      })),
    )
  }, [])
  const preview = useMemo(
    () => ({
      snapshot: createPreviewSnapshot(refreshed),
      compact,
      close: () => setNodes([]),
      refresh: () => setRefreshed(value => !value),
      resize,
    }),
    [refreshed, compact, resize],
  )
  const collapse = useMemo<WorkspaceCollapseValue>(
    (): WorkspaceCollapseValue => ({
      workspaceId: 'plugin-preview',
      nodes,
      spaces: [],
      collapsedNodeIds: collapsed ? { [PREVIEW_NODE_ID]: true as const } : {},
      collapsedSpaceIds: {},
      toggleNode: () => setCollapsed(value => !value),
      revealNode: () => setCollapsed(false),
      collapseAndArrange: noOp,
      undoArrange: noOp,
      canUndoArrange: () => false,
    }),
    [collapsed, nodes],
  )
  const projectedNodes = useMemo(
    () => projectCollapsedNodes(nodes, [], collapse),
    [nodes, collapse],
  )

  return (
    <section
      className="plugin-node-preview"
      data-testid="plugin-node-preview"
      data-preview-compact={compact || undefined}
    >
      <div className="plugin-node-preview__heading">
        <div>
          <h4>{t('settingsPanel.plugins.preview.title')}</h4>
          <p>{t('settingsPanel.plugins.preview.hint')}</p>
        </div>
        <button
          type="button"
          className="plugin-node-preview__reset"
          data-testid="plugin-preview-reset"
          aria-label={t('settingsPanel.plugins.preview.reset')}
          title={t('settingsPanel.plugins.preview.reset')}
          onClick={reset}
        >
          <RotateCcw size={15} aria-hidden="true" />
        </button>
      </div>
      <div ref={containerRef} className="plugin-node-preview__canvas workspace-canvas">
        <PreviewContext.Provider value={preview}>
          <WorkspaceCollapseContext.Provider value={collapse}>
            <WindowNodeContextMenuContext.Provider value={null}>
              <ReactFlow
                nodes={projectedNodes}
                nodeTypes={nodeTypes}
                viewport={viewport}
                minZoom={0.2}
                maxZoom={1}
                onNodesChange={onNodesChange}
                nodesConnectable={false}
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                preventScrolling={false}
                deleteKeyCode={null}
                selectionKeyCode={null}
                multiSelectionKeyCode={null}
                proOptions={{ hideAttribution: true }}
              />
            </WindowNodeContextMenuContext.Provider>
          </WorkspaceCollapseContext.Provider>
        </PreviewContext.Provider>
        {nodes.length === 0 ? (
          <div className="plugin-node-preview__closed">
            <span>{t('settingsPanel.plugins.preview.closed')}</span>
            <button
              type="button"
              className="cove-window__action cove-window__action--secondary"
              data-testid="plugin-preview-restore"
              onClick={reset}
            >
              {t('settingsPanel.plugins.preview.restore')}
            </button>
          </div>
        ) : null}
        <span className="plugin-node-preview__sample">
          {t('settingsPanel.plugins.preview.sample')}
        </span>
      </div>
      <span className="plugin-node-preview__announcement" role="status">
        {refreshed ? t('settingsPanel.plugins.preview.updated') : ''}
      </span>
    </section>
  )
}

/** This island owns all state and never mounts a runtime plugin or its IO hooks. */
export function PluginNodePreview({ pluginId }: { pluginId: string }): JSX.Element {
  const { t } = useTranslation()
  if (pluginId !== 'git-board') {
    return <p>{t('settingsPanel.plugins.preview.unavailable')}</p>
  }
  return (
    <ReactFlowProvider>
      <GitBoardPreview />
    </ReactFlowProvider>
  )
}
