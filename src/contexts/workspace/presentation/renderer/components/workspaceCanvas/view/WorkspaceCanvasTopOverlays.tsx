import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { LabelColor } from '@shared/types/labelColor'
import type { WorkspaceSpaceState } from '../../../types'
import { WorkspaceSpaceSwitcher } from './WorkspaceSpaceSwitcher'

interface WorkspaceCanvasTopOverlaysProps {
  spaces: WorkspaceSpaceState[]
  focusSpaceInViewport: (spaceId: string) => void
  focusAllInViewport: () => void
  cancelSpaceRename: () => void
  usedLabelColors: LabelColor[]
  activeLabelColorFilter: LabelColor | null
  onToggleLabelColorFilter: (color: LabelColor) => void
  selectedNodeCount: number
}

export function WorkspaceCanvasTopOverlays({
  spaces,
  focusSpaceInViewport,
  focusAllInViewport,
  cancelSpaceRename,
  usedLabelColors,
  activeLabelColorFilter,
  onToggleLabelColorFilter,
  selectedNodeCount,
}: WorkspaceCanvasTopOverlaysProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (selectedNodeCount === 0 && spaces.length === 0 && usedLabelColors.length === 0) {
    return null
  }

  return (
    <div className="workspace-canvas__top-overlays">
      {spaces.length > 0 ? (
        <WorkspaceSpaceSwitcher
          spaces={spaces}
          focusSpaceInViewport={focusSpaceInViewport}
          focusAllInViewport={focusAllInViewport}
          cancelSpaceRename={cancelSpaceRename}
        />
      ) : null}

      {usedLabelColors.length > 0 ? (
        <div
          className="workspace-label-color-filter"
          data-testid="workspace-label-color-filter"
          onMouseDown={event => {
            event.stopPropagation()
          }}
          onClick={event => {
            event.stopPropagation()
          }}
        >
          {usedLabelColors.map(color => {
            const isActive = activeLabelColorFilter === color
            return (
              <button
                key={color}
                type="button"
                className={`workspace-label-color-filter__item${isActive ? ' workspace-label-color-filter__item--active' : ''}`}
                data-cove-label-color={color}
                data-testid={`workspace-label-color-filter-${color}`}
                aria-label={t(`labelColors.${color}`)}
                aria-pressed={isActive}
                title={t(`labelColors.${color}`)}
                onClick={event => {
                  event.stopPropagation()
                  onToggleLabelColorFilter(color)
                }}
              >
                <span
                  className="cove-label-dot cove-label-dot--solid workspace-label-color-filter__dot"
                  data-cove-label-color={color}
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>
      ) : null}

      {selectedNodeCount > 0 ? (
        <div className="workspace-selection-hint">
          {t('workspaceCanvas.selectionHint', { count: selectedNodeCount })}
        </div>
      ) : null}
    </div>
  )
}
