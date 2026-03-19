import React, { useMemo, useState } from 'react'
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
  pullRequestBaseBranchOptions,
  onChangePullRequestBaseBranchOptions,
  sectionId = 'settings-section-workspace',
}: {
  workspaceName?: string | null
  workspacePath: string | null
  worktreesRoot: string
  onChangeWorktreesRoot: (worktreesRoot: string) => void
  pullRequestBaseBranchOptions: string[]
  onChangePullRequestBaseBranchOptions: (options: string[]) => void
  sectionId?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const hasWorkspace = typeof workspacePath === 'string' && workspacePath.trim().length > 0
  const [addBaseBranchInput, setAddBaseBranchInput] = useState('')
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

  const removeBaseBranchOption = (branch: string): void => {
    const next = pullRequestBaseBranchOptions.filter(option => option !== branch)
    onChangePullRequestBaseBranchOptions(next)
  }

  const addBaseBranchOption = (): void => {
    const candidate = addBaseBranchInput.trim()
    if (candidate.length === 0) {
      return
    }

    const next = pullRequestBaseBranchOptions.includes(candidate)
      ? pullRequestBaseBranchOptions
      : [...pullRequestBaseBranchOptions, candidate]
    onChangePullRequestBaseBranchOptions(next)
    setAddBaseBranchInput('')
  }

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

          <div className="settings-panel__subsection">
            <div className="settings-panel__subsection-header">
              <strong>{t('settingsPanel.workspace.pullRequestBaseBranchesLabel')}</strong>
              <span>{t('settingsPanel.workspace.pullRequestBaseBranchesHelp')}</span>
            </div>

            <div
              className="settings-list-container"
              data-testid="settings-workspace-pr-base-branch-list"
            >
              {pullRequestBaseBranchOptions.length === 0 ? (
                <div className="settings-panel__value">
                  {t('settingsPanel.workspace.pullRequestBaseBranchesEmpty')}
                </div>
              ) : (
                pullRequestBaseBranchOptions.map(branch => (
                  <div className="settings-list-item" key={branch}>
                    <span className="settings-panel__value">{branch}</span>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={() => removeBaseBranchOption(branch)}
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="settings-panel__input-row">
              <input
                type="text"
                value={addBaseBranchInput}
                placeholder={t('settingsPanel.workspace.pullRequestBaseBranchesPlaceholder')}
                onChange={event => setAddBaseBranchInput(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && addBaseBranchOption()}
              />
              <button
                type="button"
                className="primary"
                disabled={addBaseBranchInput.trim().length === 0}
                onClick={() => addBaseBranchOption()}
              >
                {t('common.add')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
