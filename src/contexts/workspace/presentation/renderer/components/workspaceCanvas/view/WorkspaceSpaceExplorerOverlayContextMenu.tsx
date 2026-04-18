import React from 'react'
import {
  Clipboard,
  Copy,
  FilePlus,
  FileText,
  FolderPlus,
  Pencil,
  RefreshCw,
  Scissors,
  Trash2,
  X,
} from 'lucide-react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { useTranslation } from '@app/renderer/i18n'
import type { FileSystemEntry } from '@shared/contracts/dto'
import { MENU_WIDTH, VIEWPORT_PADDING } from './WorkspaceContextMenu.helpers'
import type { SpaceExplorerContextMenuState } from './WorkspaceSpaceExplorerOverlay.operations'

const MENU_HEIGHT_ESTIMATE = 300

function MenuButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={event => {
        event.stopPropagation()
        onClick()
      }}
    >
      <span className="workspace-context-menu__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="workspace-context-menu__label">{label}</span>
    </button>
  )
}

function renderEntryActions({
  entry,
  t,
  canPaste,
  onOpen,
  onNewFile,
  onNewFolder,
  onRename,
  onCut,
  onCopy,
  onPaste,
  onCopyPath,
  onCopyRelativePath,
  onRefresh,
  onDelete,
}: {
  entry: FileSystemEntry
  t: ReturnType<typeof useTranslation>['t']
  canPaste: boolean
  onOpen: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onRename: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onCopyPath: () => void
  onCopyRelativePath: () => void
  onRefresh: () => void
  onDelete: () => void
}): React.JSX.Element[] {
  const actions: React.JSX.Element[] = []

  if (entry.kind === 'file') {
    actions.push(
      <MenuButton
        key="open"
        icon={<FileText size={16} />}
        label={t('spaceActions.open')}
        onClick={onOpen}
      />,
    )
  }

  if (entry.kind === 'directory') {
    actions.push(
      <MenuButton
        key="new-file"
        icon={<FilePlus size={16} />}
        label={t('spaceExplorer.newFile')}
        onClick={onNewFile}
      />,
      <MenuButton
        key="new-folder"
        icon={<FolderPlus size={16} />}
        label={t('spaceExplorer.newFolder')}
        onClick={onNewFolder}
      />,
      <div key="separator-create" className="workspace-context-menu__separator" />,
    )
  }

  actions.push(
    <MenuButton
      key="rename"
      icon={<Pencil size={16} />}
      label={t('spaceExplorer.rename')}
      onClick={onRename}
    />,
    <MenuButton
      key="cut"
      icon={<Scissors size={16} />}
      label={t('spaceExplorer.cut')}
      onClick={onCut}
    />,
    <MenuButton
      key="copy"
      icon={<Copy size={16} />}
      label={t('spaceExplorer.copy')}
      onClick={onCopy}
    />,
    <MenuButton
      key="paste"
      icon={<Clipboard size={16} />}
      label={t('spaceExplorer.paste')}
      disabled={!canPaste}
      onClick={onPaste}
    />,
    <MenuButton
      key="copy-path"
      icon={<Copy size={16} />}
      label={t('spaceExplorer.copyPath')}
      onClick={onCopyPath}
    />,
    <MenuButton
      key="copy-relative-path"
      icon={<Copy size={16} />}
      label={t('spaceExplorer.copyRelativePath')}
      onClick={onCopyRelativePath}
    />,
    <MenuButton
      key="refresh"
      icon={<RefreshCw size={16} />}
      label={t('spaceExplorer.refresh')}
      onClick={onRefresh}
    />,
    <div key="separator-danger" className="workspace-context-menu__separator" />,
    <MenuButton
      key="delete"
      icon={<Trash2 size={16} />}
      label={t('common.delete')}
      onClick={onDelete}
    />,
  )

  return actions
}

export function WorkspaceSpaceExplorerOverlayContextMenu({
  menu,
  canPaste,
  onClose,
  onOpen,
  onNewFile,
  onNewFolder,
  onRename,
  onCut,
  onCopy,
  onPaste,
  onCopyPath,
  onCopyRelativePath,
  onRefresh,
  onDelete,
}: {
  menu: SpaceExplorerContextMenuState | null
  canPaste: boolean
  onClose: () => void
  onOpen: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onRename: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onCopyPath: () => void
  onCopyRelativePath: () => void
  onRefresh: () => void
  onDelete: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!menu) {
    return null
  }

  return (
    <ViewportMenuSurface
      open
      placement={{
        type: 'point',
        point: { x: menu.x, y: menu.y },
        padding: VIEWPORT_PADDING,
        estimatedSize: { width: MENU_WIDTH, height: MENU_HEIGHT_ESTIMATE },
      }}
      className="workspace-context-menu workspace-canvas-context-menu workspace-space-explorer__context-menu"
      data-testid="workspace-space-explorer-context-menu"
      onDismiss={onClose}
      dismissOnPointerDownOutside
      dismissOnEscape
      onClick={event => {
        event.stopPropagation()
      }}
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {menu.kind === 'root' ? (
        <>
          <MenuButton
            icon={<FilePlus size={16} />}
            label={t('spaceExplorer.newFile')}
            onClick={onNewFile}
          />
          <MenuButton
            icon={<FolderPlus size={16} />}
            label={t('spaceExplorer.newFolder')}
            onClick={onNewFolder}
          />
          <MenuButton
            icon={<Clipboard size={16} />}
            label={t('spaceExplorer.paste')}
            disabled={!canPaste}
            onClick={onPaste}
          />
          <MenuButton
            icon={<Copy size={16} />}
            label={t('spaceExplorer.copyPath')}
            onClick={onCopyPath}
          />
          <MenuButton
            icon={<Copy size={16} />}
            label={t('spaceExplorer.copyRelativePath')}
            onClick={onCopyRelativePath}
          />
          <MenuButton
            icon={<RefreshCw size={16} />}
            label={t('spaceExplorer.refresh')}
            onClick={onRefresh}
          />
        </>
      ) : menu.entry ? (
        renderEntryActions({
          entry: menu.entry,
          t,
          canPaste,
          onOpen,
          onNewFile,
          onNewFolder,
          onRename,
          onCut,
          onCopy,
          onPaste,
          onCopyPath,
          onCopyRelativePath,
          onRefresh,
          onDelete,
        })
      ) : null}
      <div className="workspace-context-menu__separator" />
      <MenuButton icon={<X size={16} />} label={t('common.close')} onClick={onClose} />
    </ViewportMenuSurface>
  )
}
