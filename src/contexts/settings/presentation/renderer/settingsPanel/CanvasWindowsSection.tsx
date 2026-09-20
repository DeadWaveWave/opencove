import React from 'react'
import {
  type ViewportTransition,
  type CanvasInputMode,
  type CanvasWheelBehavior,
  type CanvasWheelZoomModifier,
  type FocusNodeTargetZoom,
  type NodeExpandBehavior,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import { CanvasSection } from './CanvasSection'
import { WindowSizeSection } from './TerminalProfileSection'

export function CanvasWindowsSection({
  canvasInputMode,
  canvasWheelBehavior,
  canvasWheelZoomModifier,
  standardWindowSizeBucket,
  nodeExpandBehavior,
  viewportTransition,
  focusNodeOnClick,
  focusNodeTargetZoom,
  focusNodeUseVisibleCanvasCenter,
  archiveSpaceDeleteWorktreeByDefault,
  archiveSpaceDeleteBranchByDefault,
  onChangeCanvasInputMode,
  onChangeCanvasWheelBehavior,
  onChangeCanvasWheelZoomModifier,
  onChangeStandardWindowSizeBucket,
  onChangeNodeExpandBehavior,
  onChangeViewportTransition,
  onChangeFocusNodeOnClick,
  onChangeFocusNodeTargetZoom,
  onChangeFocusNodeUseVisibleCanvasCenter,
  onChangeArchiveSpaceDeleteWorktreeByDefault,
  onChangeArchiveSpaceDeleteBranchByDefault,
  onFocusNodeTargetZoomPreviewChange,
}: {
  canvasInputMode: CanvasInputMode
  canvasWheelBehavior: CanvasWheelBehavior
  canvasWheelZoomModifier: CanvasWheelZoomModifier
  standardWindowSizeBucket: StandardWindowSizeBucket
  nodeExpandBehavior: NodeExpandBehavior
  viewportTransition: ViewportTransition
  focusNodeOnClick: boolean
  focusNodeTargetZoom: FocusNodeTargetZoom
  focusNodeUseVisibleCanvasCenter: boolean
  archiveSpaceDeleteWorktreeByDefault: boolean
  archiveSpaceDeleteBranchByDefault: boolean
  onChangeCanvasInputMode: (mode: CanvasInputMode) => void
  onChangeCanvasWheelBehavior: (behavior: CanvasWheelBehavior) => void
  onChangeCanvasWheelZoomModifier: (modifier: CanvasWheelZoomModifier) => void
  onChangeStandardWindowSizeBucket: (bucket: StandardWindowSizeBucket) => void
  onChangeNodeExpandBehavior: (behavior: NodeExpandBehavior) => void
  onChangeViewportTransition: (effect: ViewportTransition) => void
  onChangeFocusNodeOnClick: (enabled: boolean) => void
  onChangeFocusNodeTargetZoom: (zoom: FocusNodeTargetZoom) => void
  onChangeFocusNodeUseVisibleCanvasCenter: (enabled: boolean) => void
  onChangeArchiveSpaceDeleteWorktreeByDefault: (enabled: boolean) => void
  onChangeArchiveSpaceDeleteBranchByDefault: (enabled: boolean) => void
  onFocusNodeTargetZoomPreviewChange: (isPreviewing: boolean) => void
}): React.JSX.Element {
  return (
    <>
      <CanvasSection
        canvasInputMode={canvasInputMode}
        canvasWheelBehavior={canvasWheelBehavior}
        canvasWheelZoomModifier={canvasWheelZoomModifier}
        viewportTransition={viewportTransition}
        onChangeViewportTransition={onChangeViewportTransition}
        focusNodeOnClick={focusNodeOnClick}
        focusNodeTargetZoom={focusNodeTargetZoom}
        focusNodeUseVisibleCanvasCenter={focusNodeUseVisibleCanvasCenter}
        archiveSpaceDeleteWorktreeByDefault={archiveSpaceDeleteWorktreeByDefault}
        archiveSpaceDeleteBranchByDefault={archiveSpaceDeleteBranchByDefault}
        onChangeCanvasInputMode={onChangeCanvasInputMode}
        onChangeCanvasWheelBehavior={onChangeCanvasWheelBehavior}
        onChangeCanvasWheelZoomModifier={onChangeCanvasWheelZoomModifier}
        onChangeFocusNodeOnClick={onChangeFocusNodeOnClick}
        onChangeFocusNodeTargetZoom={onChangeFocusNodeTargetZoom}
        onChangeFocusNodeUseVisibleCanvasCenter={onChangeFocusNodeUseVisibleCanvasCenter}
        onChangeArchiveSpaceDeleteWorktreeByDefault={onChangeArchiveSpaceDeleteWorktreeByDefault}
        onChangeArchiveSpaceDeleteBranchByDefault={onChangeArchiveSpaceDeleteBranchByDefault}
        onFocusNodeTargetZoomPreviewChange={onFocusNodeTargetZoomPreviewChange}
      />
      <WindowSizeSection
        standardWindowSizeBucket={standardWindowSizeBucket}
        onChangeStandardWindowSizeBucket={onChangeStandardWindowSizeBucket}
        nodeExpandBehavior={nodeExpandBehavior}
        onChangeNodeExpandBehavior={onChangeNodeExpandBehavior}
      />
    </>
  )
}
