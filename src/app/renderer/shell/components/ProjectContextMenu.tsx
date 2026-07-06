import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, FolderOpen, FolderX, HardDrive, Pencil, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import {
  LABEL_COLORS,
  type LabelColor,
  type NodeLabelColorOverride,
} from '@shared/types/labelColor'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { ProjectContextMenuTarget } from '../types'
import { useAppStore } from '../store/useAppStore'
import {
  renameTarget,
  resolveTargetLabelColor,
  resolveTargetName,
  resolveTargetSpacePath,
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
  const openInFileManagerLabel =
    platform === 'win32'
      ? t('projectContextMenu.openInExplorer')
      : platform === 'darwin'
        ? t('projectContextMenu.openInFinder')
        : t('projectContextMenu.openInFileManager')
  const isProjectTarget = resolvedTarget.kind === 'project'
  const isSpaceTarget = resolvedTarget.kind === 'space'
  const supportsLabelColor = resolvedTarget.kind !== 'project'
  const currentLabelColor = resolveTargetLabelColor(workspaces, resolvedTarget)
  const estimatedWidth = isRenaming
    ? 236
    : isSpaceTarget
      ? 218
      : canOpenInFileManager && isProjectTarget
        ? 218
        : supportsLabelColor
          ? 204
          : 176
  const estimatedHeight = isRenaming
    ? 96
    : isSpaceTarget
      ? 174
      : canOpenInFileManager && isProjectTarget
        ? 148
        : isProjectTarget
          ? 112
          : resolvedTarget.kind === 'agent'
            ? 124
            : 102

  useEffect(() => {
    setRenameDraft(targetName ?? '')
  }, [targetName])

  useEffect(() => {
    if (!isRenaming) {
      return
    }

    window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
  }, [isRenaming])

  useEffect(() => {
    if (!isSpaceTarget || isRenaming) {
      return
    }

    window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
  }, [isRenaming, isSpaceTarget, targetName])

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
        {selected ? <Check className="workspace-project-context-menu__color-check" /> : null}
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

  return (
    <ViewportMenuSurface
      open={true}
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
      {isSpaceTarget && !isRenaming ? (
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
          <div className="workspace-context-menu__separator" />
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
              <Check className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">{t('projectContextMenu.save')}</span>
            </button>
            <button
              type="button"
              data-testid="workspace-project-context-menu-rename-cancel"
              onClick={() => {
                setIsRenaming(false)
              }}
            >
              <X className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('projectContextMenu.cancel')}
              </span>
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          data-testid="workspace-project-context-menu-rename"
          onClick={() => {
            setIsRenaming(true)
          }}
        >
          <Pencil className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">{t('projectContextMenu.rename')}</span>
        </button>
      )}
      {!isRenaming && isProjectTarget ? (
        <button
          type="button"
          data-testid={`workspace-project-manage-mounts-${workspaceId}`}
          onClick={() => {
            onRequestManageMounts(workspaceId)
          }}
        >
          <HardDrive className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('projectContextMenu.manageMounts')}
          </span>
        </button>
      ) : null}
      {!isRenaming && canOpenInFileManager && isProjectTarget ? (
        <button
          type="button"
          data-testid={`workspace-project-open-in-file-manager-${workspaceId}`}
          onClick={() => {
            onRequestOpenInFileManager(workspaceId)
          }}
        >
          <FolderOpen className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">{openInFileManagerLabel}</span>
        </button>
      ) : null}
      {!isRenaming && isSpaceTarget ? (
        <>
          <button
            type="button"
            data-testid={`workspace-space-context-copy-path-${resolvedTarget.spaceId}`}
            onClick={copySpacePath}
          >
            <Copy className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">{t('spaceActions.copyPath')}</span>
          </button>
          <button
            type="button"
            data-testid={`workspace-space-context-open-path-${resolvedTarget.spaceId}`}
            onClick={openSpacePath}
          >
            <FolderOpen className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">{t('spaceActions.open')}</span>
          </button>
        </>
      ) : null}
      {!isRenaming && isProjectTarget ? (
        <button
          type="button"
          data-testid={`workspace-project-remove-${workspaceId}`}
          onClick={() => {
            onRequestRemove(workspaceId)
          }}
        >
          <FolderX className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('projectContextMenu.removeProject')}
          </span>
        </button>
      ) : null}
      {!isRenaming && supportsLabelColor && !isSpaceTarget ? renderColorRow('section') : null}
    </ViewportMenuSurface>
  )
}
