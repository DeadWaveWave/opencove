import React, { useMemo, useState } from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { useTranslation } from '@app/renderer/i18n'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

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
      <SettingsGroup id={sectionId} title={t('settingsPanel.groups.workspace.worktrees')}>
        <SettingsGroupBody>
          {!hasWorkspace ? (
            <SettingRow
              label={t('settingsPanel.workspace.selectProjectFirst')}
              description={t('settingsPanel.workspace.selectProjectFirstHelp')}
              value={null}
            />
          ) : (
            <>
              <SettingRow
                label={t('settingsPanel.workspace.workspacePathLabel')}
                description={t('settingsPanel.workspace.workspacePathHelp', {
                  name: resolvedWorkspaceName,
                })}
                value={
                  <span
                    className="settings-panel__path-chip"
                    data-testid="settings-workspace-path-display"
                    title={workspacePath}
                  >
                    {getFolderName(workspacePath)}
                  </span>
                }
              />

              <SettingRow
                label={t('settingsPanel.workspace.worktreeRootLabel')}
                description={t('settingsPanel.workspace.worktreeRootHelp')}
                value={
                  <>
                    <input
                      data-testid="settings-worktree-root"
                      className="cove-field"
                      aria-label={t('settingsPanel.workspace.worktreeRootLabel')}
                      value={worktreesRoot}
                      placeholder={t('settingsPanel.workspace.worktreeRootPlaceholder')}
                      onChange={event => onChangeWorktreesRoot(event.target.value)}
                    />
                    <Button
                      variant="secondary"
                      disabled={worktreesRoot.trim().length === 0}
                      onClick={() => onChangeWorktreesRoot('')}
                    >
                      {t('common.resetToDefault')}
                    </Button>
                  </>
                }
              />

              <SettingRow
                label={t('settingsPanel.workspace.resolvedPathLabel')}
                description={t('settingsPanel.workspace.resolvedPathHelp')}
                value={
                  <span
                    className="settings-panel__path-chip"
                    data-testid="settings-resolved-worktree-path-display"
                    title={resolvedRoot}
                  >
                    {getTrailingPathSegments(resolvedRoot, 2)}
                  </span>
                }
              />
            </>
          )}
        </SettingsGroupBody>
      </SettingsGroup>

      {hasWorkspace ? (
        <SettingsGroup
          id="settings-section-env-vars"
          title={t('settingsPanel.groups.workspace.environment')}
          description={t('settingsPanel.workspace.environmentVariablesHelp')}
        >
          <div className="settings-list-container" data-testid="settings-env-var-list">
            {envEntries.map(([key, value]) => (
              <div className="settings-list-item" key={key}>
                <span className="settings-panel__value">
                  <strong>{key}</strong> = {value}
                </span>
                <Button
                  variant="secondary"
                  style={{ padding: '2px 8px', fontSize: '11px' }}
                  data-testid={`settings-env-var-remove-${key}`}
                  onClick={() => removeEnvVar(key)}
                >
                  {t('common.remove')}
                </Button>
              </div>
            ))}
            {envEntries.length === 0 ? (
              <span className="settings-panel__value">
                {t('settingsPanel.workspace.environmentVariablesEmpty')}
              </span>
            ) : null}
            <div className="settings-panel__input-row">
              <input
                type="text"
                data-testid="settings-env-var-key-input"
                className="cove-field"
                aria-label={t('settingsPanel.workspace.environmentVariablesKeyLabel')}
                value={envKeyInput}
                placeholder={t('settingsPanel.workspace.environmentVariablesKeyPlaceholder')}
                onChange={event => setEnvKeyInput(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && addEnvVar()}
              />
              <input
                type="text"
                data-testid="settings-env-var-value-input"
                className="cove-field"
                aria-label={t('settingsPanel.workspace.environmentVariablesValueLabel')}
                value={envValueInput}
                placeholder={t('settingsPanel.workspace.environmentVariablesValuePlaceholder')}
                onChange={event => setEnvValueInput(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && addEnvVar()}
              />
              <Button
                variant="primary"
                data-testid="settings-env-var-add-button"
                disabled={envKeyInput.trim().length === 0}
                onClick={() => addEnvVar()}
              >
                {t('common.add')}
              </Button>
            </div>
          </div>
        </SettingsGroup>
      ) : null}
    </>
  )
}
