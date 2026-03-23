import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  APP_COMMAND_IDS,
  formatKeyChord,
  hasNonShiftModifier,
  resolveEffectiveKeybindings,
  serializeKeyChord,
  toKeyChord,
  type AppCommandId,
  type KeyChord,
  type KeybindingOverrides,
} from '@contexts/settings/domain/keybindings'

type KeybindingSlot = 'primary' | 'secondary'

const TERMINAL_FOCUS_SCOPE_LABEL_BY_LOCALE: Record<string, string> = {
  en: 'terminal',
  'zh-CN': '终端',
}

const shortcutButtonStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: '11px',
}

function isSupportedChord(chord: KeyChord): boolean {
  if (hasNonShiftModifier(chord)) {
    return true
  }

  return /^F\d+$/.test(chord.code)
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return value
}

function pruneOverrides(overrides: KeybindingOverrides): KeybindingOverrides {
  const next: KeybindingOverrides = {}

  for (const commandId of APP_COMMAND_IDS) {
    const entry = overrides[commandId]
    if (!entry) {
      continue
    }

    const hasPrimary = Object.prototype.hasOwnProperty.call(entry, 'primary')
    const hasSecondary = Object.prototype.hasOwnProperty.call(entry, 'secondary')

    if (!hasPrimary && !hasSecondary) {
      continue
    }

    next[commandId] = omitUndefined({ ...entry })
  }

  return next
}

function removeSlotOverride(
  overrides: KeybindingOverrides,
  commandId: AppCommandId,
  slot: KeybindingSlot,
): KeybindingOverrides {
  const existing = overrides[commandId]
  if (!existing || !Object.prototype.hasOwnProperty.call(existing, slot)) {
    return overrides
  }

  const { [slot]: _removed, ...rest } = existing
  const next = { ...overrides }
  if (Object.keys(rest).length === 0) {
    delete next[commandId]
    return next
  }

  next[commandId] = rest
  return next
}

function setSlotOverride(
  overrides: KeybindingOverrides,
  commandId: AppCommandId,
  slot: KeybindingSlot,
  chord: KeyChord | null,
): KeybindingOverrides {
  return {
    ...overrides,
    [commandId]: {
      ...(overrides[commandId] ?? {}),
      [slot]: chord,
    },
  }
}

function getCommandTitleKey(commandId: AppCommandId): string {
  switch (commandId) {
    case 'commandCenter.toggle':
      return 'settingsPanel.shortcuts.commands.commandCenterToggle.title'
    case 'app.openSettings':
      return 'settingsPanel.shortcuts.commands.openSettings.title'
    case 'app.togglePrimarySidebar':
      return 'settingsPanel.shortcuts.commands.togglePrimarySidebar.title'
    case 'workspace.addProject':
      return 'settingsPanel.shortcuts.commands.addProject.title'
    default: {
      const _exhaustive: never = commandId
      return _exhaustive
    }
  }
}

function getCommandHelpKey(commandId: AppCommandId): string {
  switch (commandId) {
    case 'commandCenter.toggle':
      return 'settingsPanel.shortcuts.commands.commandCenterToggle.help'
    case 'app.openSettings':
      return 'settingsPanel.shortcuts.commands.openSettings.help'
    case 'app.togglePrimarySidebar':
      return 'settingsPanel.shortcuts.commands.togglePrimarySidebar.help'
    case 'workspace.addProject':
      return 'settingsPanel.shortcuts.commands.addProject.help'
    default: {
      const _exhaustive: never = commandId
      return _exhaustive
    }
  }
}

function supportsSecondaryBinding(commandId: AppCommandId): boolean {
  return commandId === 'commandCenter.toggle'
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

  const [recording, setRecording] = React.useState<{
    commandId: AppCommandId
    slot: KeybindingSlot
  } | null>(null)

  React.useEffect(() => {
    if (!recording) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setRecording(null)
        return
      }

      const chord = toKeyChord(event)
      if (!chord || !isSupportedChord(chord)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const next = (() => {
        let nextOverrides = setSlotOverride(keybindings, recording.commandId, recording.slot, chord)

        const serialized = serializeKeyChord(chord)
        const nextEffective = resolveEffectiveKeybindings({ platform, overrides: nextOverrides })

        for (const commandId of APP_COMMAND_IDS) {
          const bindings = nextEffective[commandId]
          const primary = bindings.primary
          if (
            primary &&
            serializeKeyChord(primary) === serialized &&
            !(commandId === recording.commandId && recording.slot === 'primary')
          ) {
            nextOverrides = setSlotOverride(nextOverrides, commandId, 'primary', null)
          }

          const secondary = bindings.secondary
          if (
            secondary &&
            serializeKeyChord(secondary) === serialized &&
            !(commandId === recording.commandId && recording.slot === 'secondary')
          ) {
            nextOverrides = setSlotOverride(nextOverrides, commandId, 'secondary', null)
          }
        }

        return pruneOverrides(nextOverrides)
      })()

      onChangeKeybindings(next)
      setRecording(null)
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [keybindings, onChangeKeybindings, platform, recording])

  const isRecording = (commandId: AppCommandId, slot: KeybindingSlot): boolean =>
    recording?.commandId === commandId && recording?.slot === slot

  const localeTerminalLabel =
    TERMINAL_FOCUS_SCOPE_LABEL_BY_LOCALE[i18n.language] ?? TERMINAL_FOCUS_SCOPE_LABEL_BY_LOCALE.en

  return (
    <div className="settings-panel__section" id="settings-section-shortcuts">
      <h3 className="settings-panel__section-title">{t('settingsPanel.shortcuts.title')}</h3>

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.shortcuts.disableWhenTerminalFocusedLabel')}</strong>
          <span>
            {t('settingsPanel.shortcuts.disableWhenTerminalFocusedHelp', {
              terminal: localeTerminalLabel,
            })}
          </span>
        </div>
        <div className="settings-panel__control">
          <label className="cove-toggle">
            <input
              type="checkbox"
              data-testid="settings-disable-shortcuts-when-terminal-focused"
              checked={disableAppShortcutsWhenTerminalFocused}
              onChange={event =>
                onChangeDisableAppShortcutsWhenTerminalFocused(event.target.checked)
              }
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
      </div>

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">{t('settingsPanel.shortcuts.bindings')}</h4>
          <span>{t('settingsPanel.shortcuts.bindingsHelp')}</span>
        </div>

        {APP_COMMAND_IDS.map(commandId => {
          const bindings = effectiveBindings[commandId]
          const title = t(getCommandTitleKey(commandId))
          const help = t(getCommandHelpKey(commandId))

          const renderSlot = (slot: KeybindingSlot): React.JSX.Element => {
            const chord = bindings[slot]
            const formatted = formatKeyChord(platform, chord)
            const hasBinding = formatted.length > 0

            return (
              <div className="settings-panel__row" key={`${commandId}:${slot}`}>
                <div className="settings-panel__row-label">
                  <strong>
                    {slot === 'primary'
                      ? t('settingsPanel.shortcuts.primaryLabel')
                      : t('settingsPanel.shortcuts.secondaryLabel')}
                  </strong>
                </div>
                <div className="settings-panel__control" style={{ gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    className="settings-panel__value"
                    data-testid={`settings-shortcut-value-${commandId}-${slot}`}
                  >
                    {hasBinding ? formatted : t('settingsPanel.shortcuts.unassigned')}
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    style={shortcutButtonStyle}
                    data-testid={`settings-shortcut-record-${commandId}-${slot}`}
                    onClick={() => {
                      setRecording(prev =>
                        prev && prev.commandId === commandId && prev.slot === slot
                          ? null
                          : { commandId, slot },
                      )
                    }}
                  >
                    {isRecording(commandId, slot)
                      ? t('settingsPanel.shortcuts.recording')
                      : t('settingsPanel.shortcuts.record')}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    style={shortcutButtonStyle}
                    data-testid={`settings-shortcut-clear-${commandId}-${slot}`}
                    onClick={() => {
                      const nextOverrides = pruneOverrides(
                        setSlotOverride(keybindings, commandId, slot, null),
                      )
                      onChangeKeybindings(nextOverrides)
                    }}
                    disabled={
                      !hasBinding &&
                      !Object.prototype.hasOwnProperty.call(keybindings[commandId] ?? {}, slot)
                    }
                  >
                    {t('settingsPanel.shortcuts.clear')}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    style={shortcutButtonStyle}
                    data-testid={`settings-shortcut-reset-${commandId}-${slot}`}
                    onClick={() => {
                      const nextOverrides = pruneOverrides(
                        removeSlotOverride(keybindings, commandId, slot),
                      )
                      onChangeKeybindings(nextOverrides)
                    }}
                    disabled={
                      !Object.prototype.hasOwnProperty.call(keybindings[commandId] ?? {}, slot)
                    }
                  >
                    {t('common.resetToDefault')}
                  </button>
                </div>
              </div>
            )
          }

          return (
            <div
              key={commandId}
              className="settings-panel__subsection"
              style={{ marginTop: '12px' }}
            >
              <div className="settings-panel__subsection-header">
                <h4 className="settings-panel__section-title">{title}</h4>
                <span>{help}</span>
              </div>

              {renderSlot('primary')}
              {supportsSecondaryBinding(commandId) ? renderSlot('secondary') : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
