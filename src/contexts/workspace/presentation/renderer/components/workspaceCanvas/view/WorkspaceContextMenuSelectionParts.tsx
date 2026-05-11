import React from 'react'
import { ArrowRight, ChevronRight, Group, Tag, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function WorkspaceContextSelectionMenuContent({
  createSpaceFromSelectedNodes,
  createChildSpaceFromSelectedNodes,
  openLabelColorSubmenu,
  labelColorButtonRef,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
  clearNodeSelection,
  closeContextMenu,
}: {
  createSpaceFromSelectedNodes: () => void
  createChildSpaceFromSelectedNodes: () => void
  openLabelColorSubmenu: () => void
  labelColorButtonRef: React.RefObject<HTMLButtonElement | null>
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
  clearNodeSelection: () => void
  closeContextMenu: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <button
        type="button"
        data-testid="workspace-selection-create-space"
        onClick={createSpaceFromSelectedNodes}
      >
        <Group className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('workspaceContextMenu.createSpaceWithSelected')}
        </span>
      </button>
      <button
        type="button"
        data-testid="workspace-selection-create-child-space"
        onClick={createChildSpaceFromSelectedNodes}
      >
        <Group className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('workspaceContextMenu.createChildSpaceWithSelected')}
        </span>
      </button>
      {canConvertSelectedNoteToTask ? (
        <button
          type="button"
          data-testid="workspace-selection-convert-note-to-task"
          disabled={isConvertSelectedNoteToTaskDisabled}
          onClick={convertSelectedNoteToTask}
        >
          <ArrowRight className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('workspaceContextMenu.convertToTask')}
          </span>
        </button>
      ) : null}
      <button
        ref={labelColorButtonRef}
        type="button"
        data-testid="workspace-selection-label-color"
        onMouseEnter={openLabelColorSubmenu}
        onFocus={openLabelColorSubmenu}
        onClick={openLabelColorSubmenu}
      >
        <Tag className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('labelColors.title')}</span>
        <ChevronRight
          className="workspace-context-menu__icon workspace-context-menu__chevron"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        data-testid="workspace-selection-clear"
        onClick={() => {
          clearNodeSelection()
          closeContextMenu()
        }}
      >
        <X className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('workspaceContextMenu.clearSelection')}
        </span>
      </button>
    </>
  )
}
