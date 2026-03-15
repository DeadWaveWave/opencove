import React, { useMemo } from 'react'
import { useTranslation } from '@app/renderer/i18n'

function resolveWorktreesRoot(workspacePath: string, worktreesRoot: string): string {
  const trimmed = worktreesRoot.trim()
  if (trimmed.length === 0) {
    return `${workspacePath.replace(/[/]+$/, '')}/.opencove/worktrees`
  }
  if (/^([a-zA-Z]:[/]|\/)/.test(trimmed)) {
    return trimmed.replace(/[/]+$/, '')
  }
  const base = workspacePath.replace(/[/]+$/, '')
  const normalizedCustom = trimmed
    .replace(/^[.][/]+/, '')
    .replace(/^[/]+/, '')
    .replace(/[/]+$/, '')
  return `${base}/${normalizedCustom}`
}

function getFolderName(path: string): string {
  const parts = path.split(/[/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

function getTrailingPathSegments(path: string, segmentCount: number): string {
  const normalized = path.replace(/[/]+$/, '')
  const parts = normalized.split(/[/]/).filter(Boolean)
  if (parts.length <= segmentCount) {
    return normalized || path
  }

  return `.../${parts.slice(-segmentCount).join('/')}`
}

export function WorkspaceSection({
  workspaceName,
  workspacePath,
  worktreesRoot,
  onChangeWorktreesRoot,
  sectionId = 'settings-section-workspace',
}: {
  workspaceName?: string | null
  workspacePath: string | null
  worktreesRoot: string
  onChangeWorktreesRoot: (worktreesRoot: string) => void
  sectionId?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const hasWorkspace = typeof workspacePath === 'string' && workspacePath.trim().length > 0
  const resolvedWorkspaceName = useMemo(() => {
    if (typeof workspaceName === 'string' && workspaceName.trim().length > 0) {
      return workspaceName
    }

    if (!hasWorkspace) {
      return ''
    }

    return getFolderName(workspacePath)
  }, [hasWorkspace, workspaceName, workspacePath])

  const resolvedRoot = useMemo(() => {
    if (!hasWorkspace) {
      return ''
    }

    return resolveWorktreesRoot(workspacePath, worktreesRoot)
  }, [hasWorkspace, workspacePath, worktreesRoot])

  return (
    <div className="settings-panel__section" id={sectionId}>
      <h3 className="settings-panel__section-title">{t('settingsPanel.workspace.title')}</h3>

      {!hasWorkspace ? (
        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.workspace.selectProjectFirst')}</strong>
            <span>{t('settingsPanel.workspace.selectProjectFirstHelp')}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.workspace.workspacePathLabel')}</strong>
              <span>
                {t('settingsPanel.workspace.workspacePathHelp', { name: resolvedWorkspaceName })}
              </span>
            </div>
            <div className="settings-panel__control">
              <span
                className="settings-panel__path-chip"
                data-testid="settings-workspace-path-display"
                title={workspacePath}
              >
                {getFolderName(workspacePath)}
              </span>
            </div>
          </div>

          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.workspace.worktreeRootLabel')}</strong>
              <span>{t('settingsPanel.workspace.worktreeRootHelp')}</span>
            </div>
            <div className="settings-panel__control settings-panel__control--stack">
              <input
                data-testid="settings-worktree-root"
                value={worktreesRoot}
                placeholder={t('settingsPanel.workspace.worktreeRootPlaceholder')}
                onChange={event => onChangeWorktreesRoot(event.target.value)}
              />
              <button
                type="button"
                className="secondary"
                disabled={worktreesRoot.trim().length === 0}
                onClick={() => onChangeWorktreesRoot('')}
              >
                {t('common.resetToDefault')}
              </button>
            </div>
          </div>

          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.workspace.resolvedPathLabel')}</strong>
              <span>{t('settingsPanel.workspace.resolvedPathHelp')}</span>
            </div>
            <div className="settings-panel__control">
              <span
                className="settings-panel__path-chip"
                data-testid="settings-resolved-worktree-path-display"
                title={resolvedRoot}
              >
                {getTrailingPathSegments(resolvedRoot, 2)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
