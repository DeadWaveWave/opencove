import React from 'react'
import {
  type CanvasInputMode,
  type CanvasWheelBehavior,
  type CanvasWheelZoomModifier,
  type FocusNodeTargetZoom,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import type { TerminalProfile } from '@shared/contracts/dto'
import { CanvasSection } from './CanvasSection'
import { TerminalProfileSection } from './TerminalProfileSection'

export function CanvasWindowsSection({
  canvasInputMode,
  canvasWheelBehavior,
  canvasWheelZoomModifier,
  standardWindowSizeBucket,
  focusNodeOnClick,
  focusNodeTargetZoom,
  focusNodeUseVisibleCanvasCenter,
  archiveSpaceDeleteWorktreeByDefault,
  archiveSpaceDeleteBranchByDefault,
  defaultTerminalProfileId,
  terminalProfiles,
  detectedDefaultTerminalProfileId,
  onChangeCanvasInputMode,
  onChangeCanvasWheelBehavior,
  onChangeCanvasWheelZoomModifier,
  onChangeStandardWindowSizeBucket,
  onChangeDefaultTerminalProfileId,
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
  focusNodeOnClick: boolean
  focusNodeTargetZoom: FocusNodeTargetZoom
  focusNodeUseVisibleCanvasCenter: boolean
  archiveSpaceDeleteWorktreeByDefault: boolean
  archiveSpaceDeleteBranchByDefault: boolean
  defaultTerminalProfileId: string | null
  terminalProfiles: TerminalProfile[]
  detectedDefaultTerminalProfileId: string | null
  onChangeCanvasInputMode: (mode: CanvasInputMode) => void
  onChangeCanvasWheelBehavior: (behavior: CanvasWheelBehavior) => void
  onChangeCanvasWheelZoomModifier: (modifier: CanvasWheelZoomModifier) => void
  onChangeStandardWindowSizeBucket: (bucket: StandardWindowSizeBucket) => void
  onChangeDefaultTerminalProfileId: (profileId: string | null) => void
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
      <TerminalProfileSection
        standardWindowSizeBucket={standardWindowSizeBucket}
        defaultTerminalProfileId={defaultTerminalProfileId}
        terminalProfiles={terminalProfiles}
        detectedDefaultTerminalProfileId={detectedDefaultTerminalProfileId}
        onChangeStandardWindowSizeBucket={onChangeStandardWindowSizeBucket}
        onChangeDefaultTerminalProfileId={onChangeDefaultTerminalProfileId}
      />
    </>
  )
}
