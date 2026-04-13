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
  environmentVariables,
  onChangeEnvironmentVariables,
  sectionId = 'settings-section-workspace',
}: {
  workspaceName?: string | null
  workspacePath: string | null
  worktreesRoot: string
  onChangeWorktreesRoot: (worktreesRoot: string) => void
  environmentVariables: Record<string, string>
  onChangeEnvironmentVariables: (envVars: Record<string, string>) => void
  sectionId?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const hasWorkspace = typeof workspacePath === 'string' && workspacePath.trim().length > 0
  const [envKeyInput, setEnvKeyInput] = useState('')
  const [envValueInput, setEnvValueInput] = useState('')
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

  const envEntries = useMemo(() => Object.entries(environmentVariables), [environmentVariables])

  const addEnvVar = (): void => {
    const key = envKeyInput.trim()
    if (key.length === 0) {
      return
    }
    onChangeEnvironmentVariables({ ...environmentVariables, [key]: envValueInput })
    setEnvKeyInput('')
    setEnvValueInput('')
  }

  const removeEnvVar = (key: string): void => {
    const next = { ...environmentVariables }
    delete next[key]
    onChangeEnvironmentVariables(next)
  }

  return (
    <>
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
                  className="cove-field"
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

      {hasWorkspace ? (
        <div className="settings-panel__section" id="settings-section-env-vars">
          <h3 className="settings-panel__section-title">
            {t('settingsPanel.workspace.environmentVariablesTitle')}
          </h3>

          <div className="settings-panel__subsection">
            <div className="settings-panel__subsection-header">
              <span>{t('settingsPanel.workspace.environmentVariablesHelp')}</span>
            </div>

            <div className="settings-list-container" data-testid="settings-env-var-list">
              {envEntries.map(([key, value]) => (
                <div className="settings-list-item" key={key}>
                  <span className="settings-panel__value">
                    <strong>{key}</strong> = {value}
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: '2px 8px', fontSize: '11px' }}
                    data-testid={`settings-env-var-remove-${key}`}
                    onClick={() => removeEnvVar(key)}
                  >
                    {t('common.remove')}
                  </button>
                </div>
              ))}
              {envEntries.length === 0 ? (
                <span className="settings-panel__value">
                  {t('settingsPanel.workspace.environmentVariablesEmpty')}
                </span>
              ) : null}
            </div>

            <div className="settings-panel__input-row">
              <input
                type="text"
                data-testid="settings-env-var-key-input"
                className="cove-field"
                value={envKeyInput}
                placeholder={t('settingsPanel.workspace.environmentVariablesKeyPlaceholder')}
                onChange={event => setEnvKeyInput(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && addEnvVar()}
              />
              <input
                type="text"
                data-testid="settings-env-var-value-input"
                className="cove-field"
                value={envValueInput}
                placeholder={t('settingsPanel.workspace.environmentVariablesValuePlaceholder')}
                onChange={event => setEnvValueInput(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && addEnvVar()}
              />
              <button
                type="button"
                className="primary"
                data-testid="settings-env-var-add-button"
                disabled={envKeyInput.trim().length === 0}
                onClick={() => addEnvVar()}
              >
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
