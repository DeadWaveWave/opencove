import React from 'react'
import { ArrowRight, Scan, Tag, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { menuHoverHandler } from '@app/renderer/components/menuHoverHandler'
import { MenuItem, MenuSeparator, type MenuItemShortcut } from '@app/renderer/components/ui/Menu'
import { useFilesystemNodesActions } from '../FilesystemNodesContext'
import { FilesystemPathMenuItems } from './FilesystemPathMenuItems'

export function WorkspaceContextSelectionMenuContent({
  createSpaceShortcut,
  createSpaceFromSelectedNodes,
  openLabelColorSubmenu,
  labelColorButtonRef,
  isLabelColorSubmenuOpen,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
  clearNodeSelection,
  closeContextMenu,
  closeWindow,
  nodeId,
}: {
  createSpaceShortcut?: MenuItemShortcut | null
  createSpaceFromSelectedNodes: () => void
  openLabelColorSubmenu: () => void
  labelColorButtonRef: React.RefObject<HTMLButtonElement | null>
  isLabelColorSubmenuOpen: boolean
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
  clearNodeSelection: () => void
  closeContextMenu: () => void
  closeWindow?: () => void
  nodeId?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const filesystem = useFilesystemNodesActions()
  const hasPath = nodeId && filesystem?.getNodePathUri?.(nodeId)
  const copyPath = (relative: boolean) => {
    closeContextMenu()
    if (nodeId) {
      void filesystem?.copyNodePath?.(nodeId, relative)
    }
  }

  return (
    <>
      {hasPath ? (
        <>
          <FilesystemPathMenuItems
            onCopyRelativePath={() => copyPath(true)}
            onCopyAbsolutePath={() => copyPath(false)}
          />
          <MenuSeparator />
        </>
      ) : null}
      <MenuItem
        icon={<Scan />}
        shortcut={createSpaceShortcut}
        data-testid="workspace-selection-create-space"
        onClick={createSpaceFromSelectedNodes}
      >
        {t('workspaceContextMenu.createSpaceWithSelected')}
      </MenuItem>
      {canConvertSelectedNoteToTask ? (
        <MenuItem
          icon={<ArrowRight />}
          data-testid="workspace-selection-convert-note-to-task"
          disabled={isConvertSelectedNoteToTaskDisabled}
          onClick={convertSelectedNoteToTask}
        >
          {t('workspaceContextMenu.convertToTask')}
        </MenuItem>
      ) : null}
      <MenuItem
        ref={labelColorButtonRef}
        icon={<Tag />}
        data-testid="workspace-selection-label-color"
        submenu={{ open: isLabelColorSubmenuOpen }}
        onMouseEnter={menuHoverHandler(openLabelColorSubmenu)}
        onClick={openLabelColorSubmenu}
      >
        {t('labelColors.title')}
      </MenuItem>
      <MenuItem
        icon={<X />}
        data-testid="workspace-selection-clear"
        onClick={() => {
          clearNodeSelection()
          closeContextMenu()
        }}
      >
        {t('workspaceContextMenu.clearSelection')}
      </MenuItem>
      {closeWindow ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<X />}
            tone="danger"
            data-testid="workspace-node-close"
            onClick={() => {
              closeContextMenu()
              closeWindow()
            }}
          >
            {t('common.close')}
          </MenuItem>
        </>
      ) : null}
    </>
  )
}
