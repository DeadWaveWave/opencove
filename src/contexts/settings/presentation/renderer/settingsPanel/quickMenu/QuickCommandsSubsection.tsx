import React, { useCallback, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Globe, Pin, Power, Terminal } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { QuickCommand } from '@contexts/settings/domain/agentSettings'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { moveItem } from './moveItem'

type QuickCommandDraft = {
  id: string
  title: string
  kind: 'terminal' | 'url'
  command: string
  url: string
  enabled: boolean
  pinned: boolean
}

function toQuickCommandDraft(command: QuickCommand): QuickCommandDraft {
  return command.kind === 'terminal'
    ? {
        id: command.id,
        title: command.title,
        kind: 'terminal',
        command: command.command,
        url: '',
        enabled: command.enabled,
        pinned: command.pinned,
      }
    : {
        id: command.id,
        title: command.title,
        kind: 'url',
        command: '',
        url: command.url,
        enabled: command.enabled,
        pinned: command.pinned,
      }
}

function fromQuickCommandDraft(draft: QuickCommandDraft): QuickCommand | null {
  const title = draft.title.trim()
  if (title.length === 0) {
    return null
  }

  if (draft.kind === 'terminal') {
    const command = draft.command.trim()
    if (command.length === 0) {
      return null
    }

    return {
      id: draft.id,
      title,
      kind: 'terminal',
      command,
      enabled: draft.enabled,
      pinned: draft.pinned,
    }
  }

  const url = draft.url.trim()
  if (url.length === 0) {
    return null
  }

  return {
    id: draft.id,
    title,
    kind: 'url',
    url,
    enabled: draft.enabled,
    pinned: draft.pinned,
  }
}

export function QuickCommandsSubsection({
  quickCommands,
  onChangeQuickCommands,
}: {
  quickCommands: QuickCommand[]
  onChangeQuickCommands: (commands: QuickCommand[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const [commandEditor, setCommandEditor] = useState<{
    mode: 'create' | 'edit'
    draft: QuickCommandDraft
    hasError: boolean
  } | null>(null)

  const openNewCommandEditor = useCallback(() => {
    setCommandEditor({
      mode: 'create',
      draft: {
        id: crypto.randomUUID(),
        title: '',
        kind: 'terminal',
        command: '',
        url: '',
        enabled: true,
        pinned: false,
      },
      hasError: false,
    })
  }, [])

  const openEditCommandEditor = useCallback((command: QuickCommand) => {
    setCommandEditor({
      mode: 'edit',
      draft: toQuickCommandDraft(command),
      hasError: false,
    })
  }, [])

  const closeCommandEditor = useCallback(() => {
    setCommandEditor(null)
  }, [])

  const saveCommand = useCallback(() => {
    if (!commandEditor) {
      return
    }

    const resolved = fromQuickCommandDraft(commandEditor.draft)
    if (!resolved) {
      setCommandEditor(previous => (previous ? { ...previous, hasError: true } : null))
      return
    }

    const next =
      commandEditor.mode === 'create'
        ? [...quickCommands, resolved]
        : quickCommands.map(existing => (existing.id === resolved.id ? resolved : existing))

    onChangeQuickCommands(next)
    closeCommandEditor()
  }, [closeCommandEditor, commandEditor, onChangeQuickCommands, quickCommands])

  const canMoveCommandUp = useCallback((index: number) => index > 0, [])
  const canMoveCommandDown = useCallback(
    (index: number) => index < quickCommands.length - 1,
    [quickCommands.length],
  )

  const commandKindOptions = useMemo(
    () => [
      { value: 'terminal', label: t('settingsPanel.quickMenu.commands.kind.terminal') },
      { value: 'url', label: t('settingsPanel.quickMenu.commands.kind.url') },
    ],
    [t],
  )

  const enabledToggleId = commandEditor?.draft.id
    ? `settings-quick-command-enabled-${commandEditor.draft.id}`
    : 'settings-quick-command-enabled'
  const pinnedToggleId = commandEditor?.draft.id
    ? `settings-quick-command-pinned-${commandEditor.draft.id}`
    : 'settings-quick-command-pinned'

  return (
    <div className="settings-panel__subsection">
      <div className="settings-panel__subsection-header">
        <strong>{t('settingsPanel.quickMenu.commands.title')}</strong>
        <span>{t('settingsPanel.quickMenu.commands.help')}</span>
      </div>

      <div className="settings-list-container" data-testid="settings-quick-commands-list">
        {quickCommands.map((command, index) => (
          <div className="settings-list-item" key={command.id}>
            <div className="settings-list-item__left" style={{ cursor: 'default' }}>
              {command.kind === 'terminal' ? (
                <Terminal className="workspace-context-menu__icon" aria-hidden="true" />
              ) : (
                <Globe className="workspace-context-menu__icon" aria-hidden="true" />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: 'var(--cove-text)', fontWeight: 500 }}>{command.title}</span>
                <span style={{ fontSize: '11px', color: 'var(--cove-text-muted)' }}>
                  {command.kind === 'terminal'
                    ? t('settingsPanel.quickMenu.commands.kind.terminal')
                    : t('settingsPanel.quickMenu.commands.kind.url')}
                </span>
              </div>
            </div>

            <div className="settings-agent-order__actions">
              <div
                className="settings-quick-menu__toggle"
                data-active={command.enabled ? 'true' : 'false'}
                title={t('settingsPanel.quickMenu.commands.enabled')}
              >
                <Power className="settings-quick-menu__toggle-icon" aria-hidden="true" />
                <label className="cove-toggle">
                  <input
                    type="checkbox"
                    data-testid={`settings-quick-command-enabled-${command.id}`}
                    checked={command.enabled}
                    aria-label={t('settingsPanel.quickMenu.commands.enabled')}
                    onChange={event => {
                      onChangeQuickCommands(
                        quickCommands.map(existing =>
                          existing.id === command.id
                            ? { ...existing, enabled: event.target.checked }
                            : existing,
                        ),
                      )
                    }}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>
              </div>

              <div
                className="settings-quick-menu__toggle"
                data-active={command.pinned ? 'true' : 'false'}
                title={t('settingsPanel.quickMenu.commands.pinned')}
              >
                <Pin className="settings-quick-menu__toggle-icon" aria-hidden="true" />
                <label className="cove-toggle">
                  <input
                    type="checkbox"
                    data-testid={`settings-quick-command-pinned-${command.id}`}
                    checked={command.pinned}
                    aria-label={t('settingsPanel.quickMenu.commands.pinned')}
                    onChange={event => {
                      onChangeQuickCommands(
                        quickCommands.map(existing =>
                          existing.id === command.id
                            ? { ...existing, pinned: event.target.checked }
                            : existing,
                        ),
                      )
                    }}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>
              </div>

              <button
                type="button"
                className="secondary settings-agent-order__action"
                data-testid={`settings-quick-command-move-up-${command.id}`}
                disabled={!canMoveCommandUp(index)}
                aria-label={t('settingsPanel.agent.moveUp')}
                onClick={() => onChangeQuickCommands(moveItem(quickCommands, index, index - 1))}
              >
                <ChevronUp className="settings-agent-order__icon" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="secondary settings-agent-order__action"
                data-testid={`settings-quick-command-move-down-${command.id}`}
                disabled={!canMoveCommandDown(index)}
                aria-label={t('settingsPanel.agent.moveDown')}
                onClick={() => onChangeQuickCommands(moveItem(quickCommands, index, index + 1))}
              >
                <ChevronDown className="settings-agent-order__icon" aria-hidden="true" />
              </button>

              <button
                type="button"
                className="secondary"
                data-testid={`settings-quick-command-edit-${command.id}`}
                onClick={() => openEditCommandEditor(command)}
              >
                {t('settingsPanel.quickMenu.edit')}
              </button>
              <button
                type="button"
                className="secondary settings-list-item__remove"
                data-testid={`settings-quick-command-remove-${command.id}`}
                onClick={() => {
                  onChangeQuickCommands(
                    quickCommands.filter(existing => existing.id !== command.id),
                  )
                }}
              >
                {t('common.remove')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="primary"
          data-testid="settings-quick-command-add"
          onClick={openNewCommandEditor}
        >
          {t('settingsPanel.quickMenu.commands.add')}
        </button>
      </div>

      {commandEditor ? (
        <div
          className="cove-window-backdrop"
          data-testid="settings-quick-command-editor-backdrop"
          onClick={() => {
            closeCommandEditor()
          }}
        >
          <section
            className="cove-window"
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <h3>
              {commandEditor.mode === 'create'
                ? t('settingsPanel.quickMenu.commands.createTitle')
                : t('settingsPanel.quickMenu.commands.editTitle')}
            </h3>
            <p className="cove-window__meta">{t('settingsPanel.quickMenu.commands.editorHelp')}</p>

            <div className="cove-window__field-row">
              <label htmlFor="settings-quick-command-title">
                {t('settingsPanel.quickMenu.commands.titleLabel')}
              </label>
              <input
                id="settings-quick-command-title"
                value={commandEditor.draft.title}
                placeholder={t('settingsPanel.quickMenu.commands.titlePlaceholder')}
                onChange={event => {
                  const value = event.target.value
                  setCommandEditor(previous =>
                    previous
                      ? {
                          ...previous,
                          draft: { ...previous.draft, title: value },
                          hasError: false,
                        }
                      : null,
                  )
                }}
              />
            </div>

            <div className="cove-window__field-row">
              <label htmlFor="settings-quick-command-kind">
                {t('settingsPanel.quickMenu.commands.kindLabel')}
              </label>
              <CoveSelect
                id="settings-quick-command-kind"
                testId="settings-quick-command-kind"
                value={commandEditor.draft.kind}
                options={commandKindOptions}
                onChange={nextValue => {
                  const resolvedKind = nextValue === 'url' ? 'url' : 'terminal'
                  setCommandEditor(previous =>
                    previous
                      ? {
                          ...previous,
                          draft: { ...previous.draft, kind: resolvedKind },
                          hasError: false,
                        }
                      : null,
                  )
                }}
              />
            </div>

            {commandEditor.draft.kind === 'terminal' ? (
              <div className="cove-window__field-row">
                <label htmlFor="settings-quick-command-command">
                  {t('settingsPanel.quickMenu.commands.commandLabel')}
                </label>
                <textarea
                  id="settings-quick-command-command"
                  value={commandEditor.draft.command}
                  placeholder={t('settingsPanel.quickMenu.commands.commandPlaceholder')}
                  onChange={event => {
                    const value = event.target.value
                    setCommandEditor(previous =>
                      previous
                        ? {
                            ...previous,
                            draft: { ...previous.draft, command: value },
                            hasError: false,
                          }
                        : null,
                    )
                  }}
                />
              </div>
            ) : (
              <div className="cove-window__field-row">
                <label htmlFor="settings-quick-command-url">
                  {t('settingsPanel.quickMenu.commands.urlLabel')}
                </label>
                <input
                  id="settings-quick-command-url"
                  value={commandEditor.draft.url}
                  placeholder={t('settingsPanel.quickMenu.commands.urlPlaceholder')}
                  onChange={event => {
                    const value = event.target.value
                    setCommandEditor(previous =>
                      previous
                        ? { ...previous, draft: { ...previous.draft, url: value }, hasError: false }
                        : null,
                    )
                  }}
                />
              </div>
            )}

            <div className="cove-window__field-row">
              <div className="cove-window__label-row">
                <label htmlFor={enabledToggleId}>
                  {t('settingsPanel.quickMenu.commands.enabled')}
                </label>
                <label className="cove-toggle">
                  <input
                    id={enabledToggleId}
                    type="checkbox"
                    checked={commandEditor.draft.enabled}
                    onChange={event => {
                      setCommandEditor(previous =>
                        previous
                          ? {
                              ...previous,
                              draft: { ...previous.draft, enabled: event.target.checked },
                              hasError: false,
                            }
                          : null,
                      )
                    }}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>
              </div>
              <span className="cove-window__hint">
                {t('settingsPanel.quickMenu.commands.enabledHelp')}
              </span>
            </div>

            <div className="cove-window__field-row">
              <div className="cove-window__label-row">
                <label htmlFor={pinnedToggleId}>
                  {t('settingsPanel.quickMenu.commands.pinned')}
                </label>
                <label className="cove-toggle">
                  <input
                    id={pinnedToggleId}
                    type="checkbox"
                    checked={commandEditor.draft.pinned}
                    onChange={event => {
                      setCommandEditor(previous =>
                        previous
                          ? {
                              ...previous,
                              draft: { ...previous.draft, pinned: event.target.checked },
                              hasError: false,
                            }
                          : null,
                      )
                    }}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>
              </div>
              <span className="cove-window__hint">
                {t('settingsPanel.quickMenu.commands.pinnedHelp')}
              </span>
            </div>

            {commandEditor.hasError ? (
              <p className="cove-window__error">{t('settingsPanel.quickMenu.invalidForm')}</p>
            ) : null}

            <div className="cove-window__actions">
              <button
                type="button"
                className="cove-window__action cove-window__action--ghost"
                onClick={() => {
                  closeCommandEditor()
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="cove-window__action cove-window__action--primary"
                onClick={() => {
                  saveCommand()
                }}
              >
                {t('common.save')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
