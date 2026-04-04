import React from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ViewportPortal,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { SpaceArchiveReplaySpaceRegion } from './SpaceArchiveReplaySpaceRegion'
import {
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import type { SpaceArchiveRecord } from '@contexts/workspace/presentation/renderer/types'
import {
  hasArchiveNodeFrame,
  spaceArchiveReplayNodeTypes,
  toSpaceArchiveReplayNodes,
  type SpaceArchiveReplayNode,
} from './SpaceArchiveReplayNodes'
import { useSpaceArchiveReplayWheelGestures } from './useSpaceArchiveReplayWheelGestures'
import type {
  CanvasWheelBehavior,
  CanvasWheelZoomModifier,
} from '@contexts/settings/domain/agentSettings'

export function SpaceArchiveReplayCanvas({
  record,
  canvasInputModeSetting,
  canvasWheelBehaviorSetting,
  canvasWheelZoomModifierSetting,
}: {
  record: SpaceArchiveRecord
  canvasInputModeSetting: 'mouse' | 'trackpad' | 'auto'
  canvasWheelBehaviorSetting: CanvasWheelBehavior
  canvasWheelZoomModifierSetting: CanvasWheelZoomModifier
}): React.JSX.Element {
  const { t } = useTranslation()
  const nodes = React.useMemo(() => toSpaceArchiveReplayNodes(record), [record])
  const nodesWithFrameCount = record.nodes.filter(hasArchiveNodeFrame).length
  const hasFullLayout = nodesWithFrameCount === record.nodes.length
  const canvasRef = React.useRef<HTMLDivElement | null>(null)
  const reactFlowInstanceRef = React.useRef<ReactFlowInstance<SpaceArchiveReplayNode> | null>(null)
  const viewportRef = React.useRef({ x: 0, y: 0, zoom: 1 })
  const { resolvedCanvasInputMode, useManualCanvasWheelGestures, handleWheelCapture } =
    useSpaceArchiveReplayWheelGestures({
      canvasInputModeSetting,
      canvasWheelBehaviorSetting,
      canvasWheelZoomModifierSetting,
      canvasRef,
      reactFlowInstanceRef,
      viewportRef,
    })

  const handleInit = React.useCallback((instance: ReactFlowInstance<SpaceArchiveReplayNode>) => {
    reactFlowInstanceRef.current = instance

    instance.fitView({ padding: 0.2, duration: 0, maxZoom: 1 })
    viewportRef.current = instance.getViewport()
  }, [])

  if (record.nodes.length > 0 && !hasFullLayout) {
    return (
      <div className="space-archives-window__layout">
        <p className="space-archives-window__layout-empty">
          {t('spaceArchivesWindow.layoutUnavailable')}
        </p>
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="space-archives-window__layout">
        <p className="space-archives-window__layout-empty">
          {t('spaceArchivesWindow.layoutEmpty')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-archives-window__layout" data-testid="space-archives-window-replay">
      <div
        ref={canvasRef}
        className="workspace-canvas space-archive-replay__canvas"
        data-testid="space-archives-window-replay-canvas"
        data-canvas-input-mode={resolvedCanvasInputMode}
        onWheelCapture={event => {
          handleWheelCapture(event.nativeEvent)
        }}
      >
        <ReactFlow<SpaceArchiveReplayNode>
          key={record.id}
          nodes={nodes}
          edges={[]}
          nodeTypes={spaceArchiveReplayNodeTypes}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          nodesDraggable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          minZoom={MIN_CANVAS_ZOOM}
          maxZoom={MAX_CANVAS_ZOOM}
          panOnDrag={resolvedCanvasInputMode !== 'trackpad'}
          zoomOnScroll={!useManualCanvasWheelGestures}
          panOnScroll={false}
          zoomOnPinch={!useManualCanvasWheelGestures}
          onMoveEnd={(_event, nextViewport) => {
            viewportRef.current = nextViewport
          }}
          onInit={handleInit}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            size={1}
            gap={24}
            color="var(--cove-canvas-dot)"
          />
          <ViewportPortal>
            <SpaceArchiveReplaySpaceRegion record={record} />
          </ViewportPortal>
          <Controls className="workspace-canvas__controls" showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
