import { createContext, useContext, useEffect, useId, useMemo, useState, type JSX } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginManifest } from '../../domain/pluginTypes'
import type { NodeFrame, TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { CanvasNodeWindow } from '@contexts/workspace/presentation/renderer/components/shared/CanvasNodeWindow'
import { useNodePosition } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodePosition'
import { WindowCollapsePresentation } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WindowCollapsePresentation'
import {
  WorkspaceCollapseContext,
  type WorkspaceCollapseValue,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WorkspaceCollapseContext'
import { WindowNodeContextMenuContext } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WindowNodeContextMenuContext'
import { EMPTY_NODE_KIND_DATA } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.nodeData'
import { NODE_DRAG_HANDLE_SELECTOR } from '@contexts/workspace/presentation/renderer/utils/nodeFrameResize'
import { projectCollapsedNodes } from '@contexts/workspace/presentation/renderer/utils/canvasCollapse'
import { GenericPluginView } from './GenericPluginView'
import { usePreviewViewport } from './usePreviewViewport'

type PreviewNode = Node<TerminalNodeData>
const noOp = (): void => undefined
const PreviewContext = createContext<{
  plugin: PluginManifest
  close: () => void
  resize: (frame: NodeFrame) => void
  title: (title: string) => void
} | null>(null)

function PreviewWindow({ id, data }: NodeProps<PreviewNode>): JSX.Element | null {
  const preview = useContext(PreviewContext)
  const position = useNodePosition(id)
  if (!preview) {
    return null
  }
  return (
    <WindowCollapsePresentation id={id} data={data}>
      <CanvasNodeWindow
        id={id}
        title={data.title}
        pluginId={preview.plugin.id}
        width={data.width}
        height={data.height}
        position={position}
        minSize={{
          width: preview.plugin.view?.minWidth ?? 320,
          height: preview.plugin.view?.minHeight ?? 220,
        }}
        onClose={preview.close}
        onResize={preview.resize}
        testIdPrefix="plugin-preview"
      >
        <GenericPluginView
          plugin={preview.plugin}
          nodeId={id}
          preview
          onTitleChange={preview.title}
          onViewReset={() => preview.title(preview.plugin.displayName)}
        />
      </CanvasNodeWindow>
    </WindowCollapsePresentation>
  )
}
const nodeTypes = { pluginRuntimePreview: PreviewWindow }

function createNode(plugin: PluginManifest, id: string): PreviewNode {
  return {
    id,
    type: 'pluginRuntimePreview',
    position: { x: 28, y: 28 },
    dragHandle: NODE_DRAG_HANDLE_SELECTOR,
    data: {
      ...EMPTY_NODE_KIND_DATA,
      title: plugin.displayName,
      kind: 'plugin',
      sessionId: '',
      width: plugin.view?.width ?? 600,
      height: plugin.view?.height ?? 400,
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      plugin: {
        pluginId: plugin.id,
        schemaVersion: 1,
        repoPath: '',
        mountId: null,
      },
    },
  }
}

function PreviewCanvas({
  plugin,
  onClose,
}: {
  plugin: PluginManifest
  onClose: () => void
}): JSX.Element {
  const identity = useId()
  const nodeId = `plugin-preview-${plugin.id}-${identity}`
  const [nodes, setNodes] = useState<PreviewNode[]>(() => [createNode(plugin, nodeId)])
  const [collapsed, setCollapsed] = useState(false)
  const plane = {
    width: (plugin.view?.width ?? 600) + 56,
    height: (plugin.view?.height ?? 400) + 56,
  }
  const compactWidth = Math.min(
    plugin.view?.width ?? 600,
    Math.max(plugin.view?.minWidth ?? 320, 320),
  )
  const compactPlane = { width: compactWidth + 24, height: (plugin.view?.height ?? 400) + 24 }
  const { containerRef, viewport, compact } = usePreviewViewport(plane, compactPlane)
  useEffect(() => {
    setNodes(current =>
      current.map(node => ({
        ...node,
        position: { x: compact ? 12 : 28, y: compact ? 12 : 28 },
        data: { ...node.data, width: compact ? compactWidth : (plugin.view?.width ?? 600) },
      })),
    )
  }, [compact, compactWidth, plugin.view?.width])
  const preview = useMemo(
    () => ({
      plugin,
      close: onClose,
      resize: (frame: NodeFrame) =>
        setNodes(current =>
          current.map(node => ({
            ...node,
            position: frame.position,
            data: { ...node.data, ...frame.size },
          })),
        ),
      title: (title: string) =>
        setNodes(current =>
          current.map(node =>
            node.data.title === title
              ? node
              : {
                  ...node,
                  data: { ...node.data, title },
                },
          ),
        ),
    }),
    [plugin, onClose],
  )
  const collapse = useMemo<WorkspaceCollapseValue>(
    () => ({
      workspaceId: `preview-${identity}`,
      nodes,
      spaces: [],
      collapsedNodeIds: collapsed ? { [nodeId]: true as const } : {},
      collapsedSpaceIds: {},
      toggleNode: () => setCollapsed(value => !value),
      revealNode: () => setCollapsed(false),
      collapseAndArrange: noOp,
      undoArrange: noOp,
      canUndoArrange: () => false,
    }),
    [identity, nodes, collapsed, nodeId],
  )
  const projected = useMemo(() => projectCollapsedNodes(nodes, [], collapse), [nodes, collapse])
  return (
    <div
      ref={containerRef}
      className="plugin-node-preview__canvas workspace-canvas"
      data-testid="plugin-runtime-preview-canvas"
      data-preview-compact={compact || undefined}
    >
      <PreviewContext.Provider value={preview}>
        <WorkspaceCollapseContext.Provider value={collapse}>
          <WindowNodeContextMenuContext.Provider value={null}>
            <ReactFlow
              nodes={projected}
              nodeTypes={nodeTypes}
              viewport={viewport}
              onNodesChange={changes => {
                const gestures = changes.filter(
                  change => change.type === 'position' || change.type === 'select',
                )
                if (gestures.length) {
                  setNodes(current => applyNodeChanges(gestures, current))
                }
              }}
              minZoom={0.1}
              maxZoom={1}
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
    </div>
  )
}

/** External previews are explicitly started and use their own runtime view and storage scope. */
export function PluginRuntimePreview({ plugin }: { plugin: PluginManifest }): JSX.Element {
  const { t } = useTranslation()
  const [active, setActive] = useState(false)
  return (
    <section className="plugin-node-preview" data-testid="plugin-node-preview">
      <div className="plugin-node-preview__heading">
        <div>
          <h4>{t('settingsPanel.plugins.preview.title')}</h4>
          <p>{t('settingsPanel.plugins.preview.localHint')}</p>
        </div>
        <button
          type="button"
          className="cove-window__action cove-window__action--secondary"
          data-testid="plugin-runtime-preview-toggle"
          onClick={() => setActive(value => !value)}
        >
          {t(`settingsPanel.plugins.preview.${active ? 'stop' : 'start'}`)}
        </button>
      </div>
      {active ? (
        <ReactFlowProvider>
          <PreviewCanvas plugin={plugin} onClose={() => setActive(false)} />
        </ReactFlowProvider>
      ) : null}
    </section>
  )
}
