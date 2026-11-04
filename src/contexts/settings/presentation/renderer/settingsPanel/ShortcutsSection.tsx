import React from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import {
  APP_COMMAND_IDS,
  COMMAND_IDS,
  WORKSPACE_CANVAS_COMMAND_IDS,
  isSupportedKeybindingChord,
  resolveEffectiveKeybindings,
  serializeKeyChord,
  toKeyChord,
  type CommandId,
  type KeyChord,
  type KeybindingOverrides,
} from '@contexts/settings/domain/keybindings'
import {
  KeybindingValue,
  SPATIAL_NAVIGATION_NODE_COMMAND_IDS,
  SPATIAL_NAVIGATION_SPACE_COMMAND_IDS,
  SpatialNavigationPreviewGroup,
  isSpatialNavigationCommandId,
} from './shortcuts/ShortcutKeycaps'
import { getCommandHelpKey, getCommandTitleKey } from './shortcuts/shortcutCommandKeys'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

const TERMINAL_FOCUS_SCOPE_LABEL_BY_LOCALE: Record<string, string> = {
  en: 'terminal',
  'zh-CN': '终端',
}

const shortcutButtonStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: '11px',
}

function pruneOverrides(overrides: KeybindingOverrides): KeybindingOverrides {
  const next: KeybindingOverrides = {}

  for (const commandId of COMMAND_IDS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, commandId)) {
      continue
    }

    next[commandId] = overrides[commandId] ?? null
  }

  return next
}

function removeOverride(overrides: KeybindingOverrides, commandId: CommandId): KeybindingOverrides {
  if (!Object.prototype.hasOwnProperty.call(overrides, commandId)) {
    return overrides
  }

  const next = { ...overrides }
  delete next[commandId]
  return next
}

function setOverride(
  overrides: KeybindingOverrides,
  commandId: CommandId,
  chord: KeyChord | null,
): KeybindingOverrides {
  return {
    ...overrides,
    [commandId]: chord,
  }
}

export function ShortcutsSection({
  disableAppShortcutsWhenTerminalFocused,
  keybindings,
  onChangeDisableAppShortcutsWhenTerminalFocused,
  onChangeKeybindings,
}: {
  disableAppShortcutsWhenTerminalFocused: boolean
  keybindings: KeybindingOverrides
  onChangeDisableAppShortcutsWhenTerminalFocused: (enabled: boolean) => void
  onChangeKeybindings: (nextOverrides: KeybindingOverrides) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const platform =
    typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
      ? window.opencoveApi.meta.platform
      : undefined

  const effectiveBindings = React.useMemo(
    () => resolveEffectiveKeybindings({ platform, overrides: keybindings }),
    [keybindings, platform],
  )

  const workspaceCanvasCommandIds = React.useMemo(
    () =>
      WORKSPACE_CANVAS_COMMAND_IDS.filter(commandId => !isSpatialNavigationCommandId(commandId)),
    [],
  )

  const commandGroups = React.useMemo(
    () => [
      {
        id: 'app',
        title: t('settingsPanel.shortcuts.groups.app.title'),
        help: t('settingsPanel.shortcuts.groups.app.help'),
        commandIds: APP_COMMAND_IDS,
      },
      {
        id: 'workspaceCanvas',
        title: t('settingsPanel.shortcuts.groups.workspaceCanvas.title'),
        help: t('settingsPanel.shortcuts.groups.workspaceCanvas.help'),
        commandIds: workspaceCanvasCommandIds,
      },
    ],
    [t, workspaceCanvasCommandIds],
  )

  const [recordingCommandId, setRecordingCommandId] = React.useState<CommandId | null>(null)
  const [showSpatialNavigationBindings, setShowSpatialNavigationBindings] = React.useState(false)

  React.useEffect(() => {
    if (!recordingCommandId) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setRecordingCommandId(null)
        return
      }

      const chord = toKeyChord(event)
      if (!isSupportedKeybindingChord(chord)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const next = (() => {
        let nextOverrides = setOverride(keybindings, recordingCommandId, chord)
        const serialized = serializeKeyChord(chord)
        const nextEffective = resolveEffectiveKeybindings({ platform, overrides: nextOverrides })

        for (const commandId of COMMAND_IDS) {
          const existing = nextEffective[commandId]
          if (
            commandId !== recordingCommandId &&
            existing &&
            serializeKeyChord(existing) === serialized
          ) {
            nextOverrides = setOverride(nextOverrides, commandId, null)
          }
        }

        return pruneOverrides(nextOverrides)
      })()

      onChangeKeybindings(next)
      setRecordingCommandId(null)
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [keybindings, onChangeKeybindings, platform, recordingCommandId])

  const localeTerminalLabel =
    TERMINAL_FOCUS_SCOPE_LABEL_BY_LOCALE[i18n.language] ?? TERMINAL_FOCUS_SCOPE_LABEL_BY_LOCALE.en

  const spatialNavigationSummary = (
    <SettingRow
      data-testid="settings-shortcut-spatial-navigation-summary"
      label={t('settingsPanel.shortcuts.spatialNavigation.title')}
      description={t('settingsPanel.shortcuts.spatialNavigation.help')}
      value={
        <>
          <div className="settings-panel__spatial-nav-preview">
            <SpatialNavigationPreviewGroup
              platform={platform}
              title={t('settingsPanel.shortcuts.spatialNavigation.node.title')}
              chords={{
                up: effectiveBindings['workspaceCanvas.navigateNodeUp'],
                down: effectiveBindings['workspaceCanvas.navigateNodeDown'],
                left: effectiveBindings['workspaceCanvas.navigateNodeLeft'],
                right: effectiveBindings['workspaceCanvas.navigateNodeRight'],
              }}
            />
            <SpatialNavigationPreviewGroup
              platform={platform}
              title={t('settingsPanel.shortcuts.spatialNavigation.space.title')}
              chords={{
                up: effectiveBindings['workspaceCanvas.navigateSpaceUp'],
                down: effectiveBindings['workspaceCanvas.navigateSpaceDown'],
                left: effectiveBindings['workspaceCanvas.navigateSpaceLeft'],
                right: effectiveBindings['workspaceCanvas.navigateSpaceRight'],
              }}
            />
          </div>
          <Button
            variant="secondary"
            style={shortcutButtonStyle}
            data-testid="settings-shortcut-spatial-navigation-toggle"
            onClick={() => {
              setShowSpatialNavigationBindings(current => {
                const next = !current
                if (
                  !next &&
                  recordingCommandId &&
                  isSpatialNavigationCommandId(recordingCommandId)
                ) {
                  setRecordingCommandId(null)
                }

                return next
              })
            }}
          >
            {showSpatialNavigationBindings
              ? t('settingsPanel.shortcuts.spatialNavigation.hide')
              : t('settingsPanel.shortcuts.spatialNavigation.customize')}
          </Button>
        </>
      }
    />
  )

  return (
    <SettingsGroup
      id="settings-section-shortcuts"
      title={t('settingsPanel.groups.tasksShortcuts.keyboard')}
    >
      <SettingsGroupBody>
        <SettingRow
          id="settings-disable-shortcuts-terminal-focused"
          label={t('settingsPanel.shortcuts.disableWhenTerminalFocusedLabel')}
          description={t('settingsPanel.shortcuts.disableWhenTerminalFocusedHelp', {
            terminal: localeTerminalLabel,
          })}
          control={
            <Toggle
              data-testid="settings-disable-shortcuts-when-terminal-focused"
              checked={disableAppShortcutsWhenTerminalFocused}
              label={t('settingsPanel.shortcuts.disableWhenTerminalFocusedLabel')}
              onCheckedChange={checked => onChangeDisableAppShortcutsWhenTerminalFocused(checked)}
            />
          }
        />

        <div className="settings-panel__subsection" id="settings-section-keybindings">
          <div className="settings-panel__subsection-header">
            <h4 className="settings-panel__section-title">
              {t('settingsPanel.shortcuts.bindings')}
            </h4>
            <span>{t('settingsPanel.shortcuts.bindingsHelp')}</span>
          </div>

          {commandGroups.map(group => (
            <div
              key={group.id}
              className="settings-panel__subsection"
              style={{ marginTop: '12px' }}
            >
              <div className="settings-panel__subsection-header">
                <h4 className="settings-panel__section-title">{group.title}</h4>
                <span>{group.help}</span>
              </div>

              {group.commandIds.map(commandId => {
                const chord = effectiveBindings[commandId]
                const hasBinding = chord !== null

                return (
                  <SettingRow
                    key={commandId}
                    label={t(getCommandTitleKey(commandId))}
                    description={t(getCommandHelpKey(commandId))}
                    value={
                      <>
                        {chord ? (
                          <KeybindingValue
                            platform={platform}
                            chord={chord}
                            testId={`settings-shortcut-value-${commandId}`}
                          />
                        ) : (
                          <span
                            className="settings-panel__value"
                            data-testid={`settings-shortcut-value-${commandId}`}
                            data-keybinding=""
                          >
                            {t('settingsPanel.shortcuts.unassigned')}
                          </span>
                        )}
                        <Button
                          variant="secondary"
                          style={shortcutButtonStyle}
                          data-testid={`settings-shortcut-record-${commandId}`}
                          onClick={() => {
                            setRecordingCommandId(current =>
                              current === commandId ? null : commandId,
                            )
                          }}
                        >
                          {recordingCommandId === commandId
                            ? t('settingsPanel.shortcuts.recording')
                            : t('settingsPanel.shortcuts.record')}
                        </Button>
                        <Button
                          variant="secondary"
                          style={shortcutButtonStyle}
                          data-testid={`settings-shortcut-clear-${commandId}`}
                          onClick={() => {
                            onChangeKeybindings(
                              pruneOverrides(setOverride(keybindings, commandId, null)),
                            )
                          }}
                          disabled={
                            !hasBinding &&
                            !Object.prototype.hasOwnProperty.call(keybindings, commandId)
                          }
                        >
                          {t('settingsPanel.shortcuts.clear')}
                        </Button>
                        <Button
                          variant="secondary"
                          style={shortcutButtonStyle}
                          data-testid={`settings-shortcut-reset-${commandId}`}
                          onClick={() => {
                            onChangeKeybindings(
                              pruneOverrides(removeOverride(keybindings, commandId)),
                            )
                          }}
                          disabled={!Object.prototype.hasOwnProperty.call(keybindings, commandId)}
                        >
                          {t('common.resetToDefault')}
                        </Button>
                      </>
                    }
                  />
                )
              })}

              {group.id === 'workspaceCanvas' ? (
                <>
                  {spatialNavigationSummary}
                  {showSpatialNavigationBindings ? (
                    <div className="settings-panel__subsection settings-panel__subsection--spatial-nav">
                      {[
                        ...SPATIAL_NAVIGATION_NODE_COMMAND_IDS,
                        ...SPATIAL_NAVIGATION_SPACE_COMMAND_IDS,
                      ].map(commandId => {
                        const chord = effectiveBindings[commandId]
                        const hasBinding = chord !== null

                        return (
                          <SettingRow
                            key={commandId}
                            label={t(getCommandTitleKey(commandId))}
                            description={t(getCommandHelpKey(commandId))}
                            value={
                              <>
                                {chord ? (
                                  <KeybindingValue
                                    platform={platform}
                                    chord={chord}
                                    testId={`settings-shortcut-value-${commandId}`}
                                  />
                                ) : (
                                  <span
                                    className="settings-panel__value"
                                    data-testid={`settings-shortcut-value-${commandId}`}
                                    data-keybinding=""
                                  >
                                    {t('settingsPanel.shortcuts.unassigned')}
                                  </span>
                                )}
                                <Button
                                  variant="secondary"
                                  style={shortcutButtonStyle}
                                  data-testid={`settings-shortcut-record-${commandId}`}
                                  onClick={() => {
                                    setRecordingCommandId(current =>
                                      current === commandId ? null : commandId,
                                    )
                                  }}
                                >
                                  {recordingCommandId === commandId
                                    ? t('settingsPanel.shortcuts.recording')
                                    : t('settingsPanel.shortcuts.record')}
                                </Button>
                                <Button
                                  variant="secondary"
                                  style={shortcutButtonStyle}
                                  data-testid={`settings-shortcut-clear-${commandId}`}
                                  onClick={() => {
                                    onChangeKeybindings(
                                      pruneOverrides(setOverride(keybindings, commandId, null)),
                                    )
                                  }}
                                  disabled={
                                    !hasBinding &&
                                    !Object.prototype.hasOwnProperty.call(keybindings, commandId)
                                  }
                                >
                                  {t('settingsPanel.shortcuts.clear')}
                                </Button>
                                <Button
                                  variant="secondary"
                                  style={shortcutButtonStyle}
                                  data-testid={`settings-shortcut-reset-${commandId}`}
                                  onClick={() => {
                                    onChangeKeybindings(
                                      pruneOverrides(removeOverride(keybindings, commandId)),
                                    )
                                  }}
                                  disabled={
                                    !Object.prototype.hasOwnProperty.call(keybindings, commandId)
                                  }
                                >
                                  {t('common.resetToDefault')}
                                </Button>
                              </>
                            }
                          />
                        )
                      })}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
