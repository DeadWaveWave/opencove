import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DriveIcon,
  EditIcon,
  FolderOpenIcon,
  FolderXIcon,
  PinIcon,
  PinOffIcon,
} from '@app/renderer/components/ui/pixelIcons'
import { useTranslation } from '@app/renderer/i18n'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { MenuItem, MenuSeparator } from '@app/renderer/components/ui/Menu'
import {
  LABEL_COLORS,
  type LabelColor,
  type NodeLabelColorOverride,
} from '@shared/types/labelColor'
import { PROJECT_ICON_IDS, type ProjectIconId } from '@shared/types/projectIcon'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { ProjectContextMenuTarget } from '../types'
import { useAppStore } from '../store/useAppStore'
import { ProjectIcon } from './ProjectIcon'
import { useProjectContextMenuFocus } from './useProjectContextMenuFocus'
import { SidebarVisibilityMenuItem } from './SidebarVisibilityMenuItem'
import {
  renameTarget,
  resolveTargetAgentPinned,
  resolveTargetProjectIconId,
  resolveTargetSpacePinned,
  resolveTargetLabelColor,
  resolveTargetName,
  resolveTargetSpacePath,
  setTargetProjectIconId,
  setTargetAgentPinned,
  setTargetSpacePinned,
  setTargetLabelColor,
} from './ProjectContextMenu.state'

export function ProjectContextMenu({
  workspaces,
  workspaceId,
  target,
  x,
  y,
  onRequestManageMounts,
  onRequestOpenInFileManager,
  onRequestRemove,
}: {
  workspaces: WorkspaceState[]
  workspaceId: string
  target?: ProjectContextMenuTarget
  x: number
  y: number
  onRequestManageMounts: (workspaceId: string) => void
  onRequestOpenInFileManager: (workspaceId: string) => void
  onRequestRemove: (workspaceId: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const runtime = window.opencoveApi?.meta?.runtime
  const platform = window.opencoveApi?.meta?.platform
  const canOpenInFileManager = runtime === 'electron'
  const resolvedTarget = useMemo<ProjectContextMenuTarget>(
    () => target ?? { kind: 'project', workspaceId },
    [target, workspaceId],
  )
  const targetName = resolveTargetName(workspaces, resolvedTarget)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState(targetName ?? '')
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const openInFileManagerLabel =
    platform === 'win32'
      ? t('projectContextMenu.openInExplorer')
      : platform === 'darwin'
        ? t('projectContextMenu.openInFinder')
        : t('projectContextMenu.openInFileManager')
  const isProjectTarget = resolvedTarget.kind === 'project'
  const isSpaceTarget = resolvedTarget.kind === 'space'
  const isAgentTarget = resolvedTarget.kind === 'agent'
  const isInlineEditorTarget = isSpaceTarget || isAgentTarget
  const supportsLabelColor = resolvedTarget.kind !== 'project'
  const currentProjectIconId = resolveTargetProjectIconId(workspaces, resolvedTarget)
  const currentLabelColor = resolveTargetLabelColor(workspaces, resolvedTarget)
  const isSpacePinned = resolveTargetSpacePinned(workspaces, resolvedTarget)
  const isAgentPinned = resolveTargetAgentPinned(resolvedTarget)
  const estimatedWidth = isRenaming
    ? 236
    : isInlineEditorTarget
      ? 218
      : canOpenInFileManager && isProjectTarget
        ? 218
        : supportsLabelColor
          ? 204
          : 176
  const estimatedHeight = isRenaming
    ? 96
    : isInlineEditorTarget
      ? 132
      : canOpenInFileManager && isProjectTarget
        ? 218
        : isProjectTarget
          ? 182
          : 102

  useEffect(() => {
    setRenameDraft(targetName ?? '')
  }, [targetName])

  useProjectContextMenuFocus({
    menuRef,
    inputRef: renameInputRef,
    isEditing: isRenaming || isInlineEditorTarget,
    targetKey: `${workspaceId}:${resolvedTarget.kind}:${resolvedTarget.kind === 'space' ? resolvedTarget.spaceId : resolvedTarget.kind === 'agent' ? resolvedTarget.nodeId : ''}`,
  })

  if (targetName === null) {
    return null
  }

  const applyRename = (): void => {
    renameTarget(resolvedTarget, renameDraft)
  }
  const commitRename = (): void => {
    applyRename()
    useAppStore.getState().setProjectContextMenu(null)
  }
  const commitLabelColor = (labelColor: LabelColor | NodeLabelColorOverride | null): void => {
    setTargetLabelColor(resolvedTarget, labelColor)
  }
  const commitProjectIcon = (iconId: ProjectIconId | null): void => {
    setTargetProjectIconId(resolvedTarget, iconId)
  }
  const copySpacePath = (): void => {
    const path = resolveTargetSpacePath(workspaces, resolvedTarget)
    useAppStore.getState().setProjectContextMenu(null)
    if (!path) {
      return
    }
    const copyPath = window.opencoveApi?.workspace?.copyPath
    if (typeof copyPath === 'function') {
      void copyPath({ path })
      return
    }
    const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard
    if (clipboard && typeof clipboard.writeText === 'function') {
      void clipboard.writeText(path).catch(() => undefined)
    }
  }
  const openSpacePath = (): void => {
    const path = resolveTargetSpacePath(workspaces, resolvedTarget)
    useAppStore.getState().setProjectContextMenu(null)
    if (!path) {
      return
    }
    const openPath = window.opencoveApi?.workspace?.openPath
    if (typeof openPath !== 'function') {
      return
    }
    void openPath({ path, openerId: 'finder' })
  }
  const toggleSpacePinned = (): void => {
    setTargetSpacePinned(resolvedTarget, !isSpacePinned)
    useAppStore.getState().setProjectContextMenu(null)
  }
  const toggleAgentPinned = (): void => {
    setTargetAgentPinned(resolvedTarget, !isAgentPinned)
    useAppStore.getState().setProjectContextMenu(null)
  }

  const renderColorButton = ({
    id,
    label,
    labelColor,
    dotClassName = '',
  }: {
    id: string
    label: string
    labelColor: LabelColor | NodeLabelColorOverride | null
    dotClassName?: string
  }): React.JSX.Element => {
    const selected = currentLabelColor === labelColor
    return (
      <button
        type="button"
        className={`workspace-project-context-menu__color-button${selected ? ' workspace-project-context-menu__color-button--selected' : ''}`}
        data-testid={`workspace-project-context-menu-label-color-${id}`}
        aria-label={label}
        aria-pressed={selected}
        title={label}
        onClick={() => {
          commitLabelColor(labelColor)
        }}
      >
        <span
          className={`workspace-label-color-menu__dot ${dotClassName}`.trim()}
          data-cove-label-color={
            typeof labelColor === 'string' && labelColor !== 'none' ? labelColor : undefined
          }
          aria-hidden="true"
        />
      </button>
    )
  }
  const renderColorRow = (variant: 'space' | 'section'): React.JSX.Element | null => {
    if (!supportsLabelColor) {
      return null
    }

    return (
      <div
        className={`workspace-project-context-menu__color-${variant}`}
        data-testid="workspace-project-context-menu-label-colors"
      >
        {variant === 'section' ? (
          <div className="workspace-context-menu__section-title">{t('labelColors.title')}</div>
        ) : null}
        <div className="workspace-project-context-menu__color-grid">
          {resolvedTarget.kind === 'agent'
            ? renderColorButton({
                id: 'auto',
                label: t('labelColors.autoInherit'),
                labelColor: null,
                dotClassName: 'workspace-label-color-menu__dot--auto',
              })
            : null}
          {renderColorButton({
            id: 'none',
            label: t('labelColors.none'),
            labelColor: resolvedTarget.kind === 'agent' ? 'none' : null,
            dotClassName: 'workspace-label-color-menu__dot--none',
          })}
          {LABEL_COLORS.map(color =>
            renderColorButton({
              id: color,
              label: t(`labelColors.${color}`),
              labelColor: color,
            }),
          )}
        </div>
      </div>
    )
  }
  const renderProjectIconButton = ({
    id,
    iconId,
    label,
  }: {
    id: string
    iconId: ProjectIconId | null
    label: string
  }): React.JSX.Element => {
    const selected = currentProjectIconId === iconId
    return (
      <button
        type="button"
        className={`workspace-project-context-menu__project-icon-button${selected ? ' workspace-project-context-menu__project-icon-button--selected' : ''}`}
        data-testid={`workspace-project-context-menu-icon-${id}`}
        aria-label={label}
        aria-pressed={selected}
        title={label}
        onClick={() => {
          commitProjectIcon(iconId)
        }}
      >
        <ProjectIcon iconId={iconId} className="workspace-project-context-menu__project-icon" />
      </button>
    )
  }
  const renderProjectIconRow = (): React.JSX.Element | null => {
    if (!isProjectTarget) {
      return null
    }
    return (
      <div
        className="workspace-project-context-menu__project-icon-section"
        data-testid="workspace-project-context-menu-icons"
      >
        <div className="workspace-context-menu__section-title">
          {t('projectContextMenu.projectIcon')}
        </div>
        <div className="workspace-project-context-menu__project-icon-grid">
          {renderProjectIconButton({
            id: 'default',
            iconId: null,
            label: t('projectContextMenu.defaultProjectIcon'),
          })}
          {PROJECT_ICON_IDS.map(iconId =>
            renderProjectIconButton({
              id: iconId,
              iconId,
              label: t(`projectContextMenu.icons.${iconId}`),
            }),
          )}
        </div>
      </div>
    )
  }

  return (
    <ViewportMenuSurface
      ref={menuRef}
      open={true}
      mobileTitle={isRenaming ? t('projectContextMenu.rename') : targetName}
      onBack={isRenaming ? () => setIsRenaming(false) : undefined}
      initialFocusRef={isRenaming || isInlineEditorTarget ? renameInputRef : undefined}
      onDismiss={() => useAppStore.getState().setProjectContextMenu(null)}
      dismissOnEscape
      className={`workspace-context-menu workspace-project-context-menu workspace-project-context-menu--${resolvedTarget.kind}`}
      placement={{
        type: 'point',
        point: { x, y },
        estimatedSize: {
          width: estimatedWidth,
          height: estimatedHeight,
        },
      }}
    >
      {isInlineEditorTarget && !isRenaming ? (
        <>
          <form
            className="workspace-project-context-menu__space-editor"
            onSubmit={event => {
              event.preventDefault()
              commitRename()
            }}
          >
            <input
              ref={renameInputRef}
              value={renameDraft}
              aria-label={t('projectContextMenu.rename')}
              onChange={event => {
                setRenameDraft(event.target.value)
              }}
              onBlur={applyRename}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  useAppStore.getState().setProjectContextMenu(null)
                }
              }}
            />
          </form>
          {renderColorRow('space')}
          <MenuSeparator />
        </>
      ) : isRenaming ? (
        <form
          className="workspace-project-context-menu__rename"
          onSubmit={event => {
            event.preventDefault()
            commitRename()
          }}
        >
          <input
            ref={renameInputRef}
            value={renameDraft}
            aria-label={t('projectContextMenu.rename')}
            onChange={event => {
              setRenameDraft(event.target.value)
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setIsRenaming(false)
              }
            }}
          />
          <div className="workspace-project-context-menu__rename-actions">
            <button type="submit" data-testid="workspace-project-context-menu-rename-save">
              <CheckIcon className="workspace-context-menu__icon" />
              <span className="workspace-context-menu__label">{t('projectContextMenu.save')}</span>
            </button>
            <button
              type="button"
              data-testid="workspace-project-context-menu-rename-cancel"
              onClick={() => {
                setIsRenaming(false)
              }}
            >
              <CloseIcon className="workspace-context-menu__icon" />
              <span className="workspace-context-menu__label">
                {t('projectContextMenu.cancel')}
              </span>
            </button>
          </div>
        </form>
      ) : (
        <MenuItem
          icon={<EditIcon />}
          data-testid="workspace-project-context-menu-rename"
          onClick={() => {
            setIsRenaming(true)
          }}
        >
          {t('projectContextMenu.rename')}
        </MenuItem>
      )}
      {!isRenaming && isProjectTarget ? renderProjectIconRow() : null}
      {!isRenaming && isProjectTarget ? (
        <MenuItem
          icon={<DriveIcon />}
          data-testid={`workspace-project-manage-mounts-${workspaceId}`}
          onClick={() => {
            onRequestManageMounts(workspaceId)
          }}
        >
          {t('projectContextMenu.manageMounts')}
        </MenuItem>
      ) : null}
      {!isRenaming && canOpenInFileManager && isProjectTarget ? (
        <MenuItem
          icon={<FolderOpenIcon />}
          data-testid={`workspace-project-open-in-file-manager-${workspaceId}`}
          onClick={() => {
            onRequestOpenInFileManager(workspaceId)
          }}
        >
          {openInFileManagerLabel}
        </MenuItem>
      ) : null}
      {!isRenaming && isSpaceTarget ? (
        <>
          <MenuItem
            icon={isSpacePinned ? <PinOffIcon /> : <PinIcon />}
            data-testid={`workspace-space-context-pin-${resolvedTarget.spaceId}`}
            onClick={toggleSpacePinned}
          >
            {isSpacePinned ? t('projectContextMenu.unpinSpace') : t('projectContextMenu.pinSpace')}
          </MenuItem>
          <MenuItem
            icon={<CopyIcon />}
            data-testid={`workspace-space-context-copy-path-${resolvedTarget.spaceId}`}
            onClick={copySpacePath}
          >
            {t('spaceActions.copyPath')}
          </MenuItem>
          <MenuItem
            icon={<FolderOpenIcon />}
            data-testid={`workspace-space-context-open-path-${resolvedTarget.spaceId}`}
            onClick={openSpacePath}
          >
            {t('spaceActions.open')}
          </MenuItem>
        </>
      ) : null}
      {!isRenaming && isAgentTarget ? (
        <MenuItem
          icon={isAgentPinned ? <PinOffIcon /> : <PinIcon />}
          data-testid={`workspace-agent-context-pin-${resolvedTarget.nodeId}`}
          onClick={toggleAgentPinned}
        >
          {isAgentPinned ? t('projectContextMenu.unpinAgent') : t('projectContextMenu.pinAgent')}
        </MenuItem>
      ) : null}
      {!isRenaming && isProjectTarget ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<FolderXIcon />}
            tone="danger"
            data-testid={`workspace-project-remove-${workspaceId}`}
            onClick={() => {
              onRequestRemove(workspaceId)
            }}
          >
            {t('projectContextMenu.removeProject')}
          </MenuItem>
        </>
      ) : null}
      {!isRenaming && supportsLabelColor && !isInlineEditorTarget
        ? renderColorRow('section')
        : null}
      {!isRenaming ? <SidebarVisibilityMenuItem target={resolvedTarget} /> : null}
    </ViewportMenuSurface>
  )
}
