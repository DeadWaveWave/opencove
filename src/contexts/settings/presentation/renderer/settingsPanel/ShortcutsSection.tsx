import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  APP_COMMAND_IDS,
  COMMAND_IDS,
  WORKSPACE_CANVAS_COMMAND_IDS,
  formatKeyChord,
  formatKeyChordParts,
  isSupportedKeybindingChord,
  resolveEffectiveKeybindings,
  serializeKeyChord,
  toKeyChord,
  type CommandId,
  type FormattedKeyChordParts,
  type KeyChord,
  type KeybindingOverrides,
} from '@contexts/settings/domain/keybindings'

const TERMINAL_FOCUS_SCOPE_LABEL_BY_LOCALE: Record<string, string> = {
  en: 'terminal',
  'zh-CN': '终端',
}

const SPATIAL_NAVIGATION_NODE_COMMAND_IDS: CommandId[] = [
  'workspaceCanvas.navigateNodeLeft',
  'workspaceCanvas.navigateNodeRight',
  'workspaceCanvas.navigateNodeUp',
  'workspaceCanvas.navigateNodeDown',
]

const SPATIAL_NAVIGATION_SPACE_COMMAND_IDS: CommandId[] = [
  'workspaceCanvas.navigateSpaceLeft',
  'workspaceCanvas.navigateSpaceRight',
  'workspaceCanvas.navigateSpaceUp',
  'workspaceCanvas.navigateSpaceDown',
]

function isSpatialNavigationCommandId(commandId: CommandId): boolean {
  return (
    commandId.startsWith('workspaceCanvas.navigateNode') ||
    commandId.startsWith('workspaceCanvas.navigateSpace')
  )
}

function joinKeyChordPartsText(platform: string | undefined, parts: FormattedKeyChordParts): string {
  if (platform === 'darwin') {
    return `${parts.modifiers.join('')}${parts.key}`
  }

  return `${[...parts.modifiers, parts.key].join(' ')}`
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  return a.every((value, index) => value === b[index])
}

function Keycaps({
  tokens,
  'aria-label': ariaLabel,
}: {
  tokens: string[]
  'aria-label'?: string
}): React.JSX.Element {
  return (
    <span className="settings-panel__keybinding" aria-label={ariaLabel}>
      {tokens.map((token, index) => (
        <span key={`${token}-${index}`} className="settings-panel__keycap">
          {token}
        </span>
      ))}
    </span>
  )
}

function KeybindingValue({
  platform,
  chord,
  formatted,
  testId,
}: {
  platform: string | undefined
  chord: KeyChord | null
  formatted: string
  testId: string
}): React.JSX.Element {
  const parts = formatKeyChordParts(platform, chord)
  const tokens = parts ? [...parts.modifiers, parts.key] : []

  return (
    <span
      className="settings-panel__value settings-panel__value--keybinding"
      data-testid={testId}
      data-keybinding={formatted}
      title={formatted}
    >
      <Keycaps tokens={tokens.length > 0 ? tokens : ['—']} aria-label={formatted} />
    </span>
  )
}

function SpatialNavigationPreviewGroup({
  platform,
  title,
  chords,
}: {
  platform: string | undefined
  title: string
  chords: {
    up: KeyChord | null
    down: KeyChord | null
    left: KeyChord | null
    right: KeyChord | null
  }
}): React.JSX.Element {
  const up = formatKeyChordParts(platform, chords.up)
  const down = formatKeyChordParts(platform, chords.down)
  const left = formatKeyChordParts(platform, chords.left)
  const right = formatKeyChordParts(platform, chords.right)
  const partsList = [up, down, left, right].filter(Boolean) as FormattedKeyChordParts[]
  const hasCommonModifiers =
    partsList.length > 0 && partsList.every(parts => areStringArraysEqual(parts.modifiers, partsList[0].modifiers))
  const commonModifiers = hasCommonModifiers ? partsList[0].modifiers : []

  const cellTokens = (parts: FormattedKeyChordParts | null): string[] => {
    if (!parts) {
      return ['—']
    }

    return hasCommonModifiers ? [parts.key] : [...parts.modifiers, parts.key]
  }

  const cellLabel = (parts: FormattedKeyChordParts | null): string => {
    if (!parts) {
      return '—'
    }

    return joinKeyChordPartsText(platform, parts)
  }

  return (
    <div className="settings-panel__spatial-nav-preview-group">
      <div className="settings-panel__spatial-nav-preview-heading">
        <span className="settings-panel__spatial-nav-preview-title">{title}</span>
        {hasCommonModifiers && commonModifiers.length > 0 ? (
          <Keycaps tokens={commonModifiers} aria-label={commonModifiers.join(' ')} />
        ) : null}
      </div>
      <div className="settings-panel__spatial-nav-dpad" role="group" aria-label={title}>
        <div />
        <span className="settings-panel__spatial-nav-cell">
          <Keycaps tokens={cellTokens(up)} aria-label={cellLabel(up)} />
        </span>
        <div />
        <span className="settings-panel__spatial-nav-cell">
          <Keycaps tokens={cellTokens(left)} aria-label={cellLabel(left)} />
        </span>
        <div className="settings-panel__spatial-nav-cell settings-panel__spatial-nav-cell--center" />
        <span className="settings-panel__spatial-nav-cell">
          <Keycaps tokens={cellTokens(right)} aria-label={cellLabel(right)} />
        </span>
        <div />
        <span className="settings-panel__spatial-nav-cell">
          <Keycaps tokens={cellTokens(down)} aria-label={cellLabel(down)} />
        </span>
        <div />
      </div>
    </div>
  )
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

function getCommandTitleKey(commandId: CommandId): string {
  switch (commandId) {
    case 'commandCenter.toggle':
      return 'settingsPanel.shortcuts.commands.commandCenterToggle.title'
    case 'app.openSettings':
      return 'settingsPanel.shortcuts.commands.openSettings.title'
    case 'app.togglePrimarySidebar':
      return 'settingsPanel.shortcuts.commands.togglePrimarySidebar.title'
    case 'workspace.addProject':
      return 'settingsPanel.shortcuts.commands.addProject.title'
    case 'workspace.search':
      return 'settingsPanel.shortcuts.commands.workspaceSearch.title'
    case 'workspaceCanvas.createSpace':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateSpace.title'
    case 'workspaceCanvas.createNote':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateNote.title'
    case 'workspaceCanvas.createTerminal':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateTerminal.title'
    case 'workspaceCanvas.cycleSpacesForward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleSpacesForward.title'
    case 'workspaceCanvas.cycleSpacesBackward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleSpacesBackward.title'
    case 'workspaceCanvas.cycleIdleSpacesForward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleIdleSpacesForward.title'
    case 'workspaceCanvas.cycleIdleSpacesBackward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleIdleSpacesBackward.title'
    case 'workspaceCanvas.navigateNodeLeft':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeLeft.title'
    case 'workspaceCanvas.navigateNodeRight':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeRight.title'
    case 'workspaceCanvas.navigateNodeUp':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeUp.title'
    case 'workspaceCanvas.navigateNodeDown':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeDown.title'
    case 'workspaceCanvas.navigateSpaceLeft':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceLeft.title'
    case 'workspaceCanvas.navigateSpaceRight':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceRight.title'
    case 'workspaceCanvas.navigateSpaceUp':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceUp.title'
    case 'workspaceCanvas.navigateSpaceDown':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceDown.title'
    default: {
      const _exhaustive: never = commandId
      return _exhaustive
    }
  }
}

function getCommandHelpKey(commandId: CommandId): string {
  switch (commandId) {
    case 'commandCenter.toggle':
      return 'settingsPanel.shortcuts.commands.commandCenterToggle.help'
    case 'app.openSettings':
      return 'settingsPanel.shortcuts.commands.openSettings.help'
    case 'app.togglePrimarySidebar':
      return 'settingsPanel.shortcuts.commands.togglePrimarySidebar.help'
    case 'workspace.addProject':
      return 'settingsPanel.shortcuts.commands.addProject.help'
    case 'workspace.search':
      return 'settingsPanel.shortcuts.commands.workspaceSearch.help'
    case 'workspaceCanvas.createSpace':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateSpace.help'
    case 'workspaceCanvas.createNote':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateNote.help'
    case 'workspaceCanvas.createTerminal':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCreateTerminal.help'
    case 'workspaceCanvas.cycleSpacesForward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleSpacesForward.help'
    case 'workspaceCanvas.cycleSpacesBackward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleSpacesBackward.help'
    case 'workspaceCanvas.cycleIdleSpacesForward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleIdleSpacesForward.help'
    case 'workspaceCanvas.cycleIdleSpacesBackward':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasCycleIdleSpacesBackward.help'
    case 'workspaceCanvas.navigateNodeLeft':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeLeft.help'
    case 'workspaceCanvas.navigateNodeRight':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeRight.help'
    case 'workspaceCanvas.navigateNodeUp':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeUp.help'
    case 'workspaceCanvas.navigateNodeDown':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateNodeDown.help'
    case 'workspaceCanvas.navigateSpaceLeft':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceLeft.help'
    case 'workspaceCanvas.navigateSpaceRight':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceRight.help'
    case 'workspaceCanvas.navigateSpaceUp':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceUp.help'
    case 'workspaceCanvas.navigateSpaceDown':
      return 'settingsPanel.shortcuts.commands.workspaceCanvasNavigateSpaceDown.help'
    default: {
      const _exhaustive: never = commandId
      return _exhaustive
    }
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
    () => WORKSPACE_CANVAS_COMMAND_IDS.filter(commandId => !isSpatialNavigationCommandId(commandId)),
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
    <div className="settings-panel__row" data-testid="settings-shortcut-spatial-navigation-summary">
      <div className="settings-panel__row-label">
        <strong>{t('settingsPanel.shortcuts.spatialNavigation.title')}</strong>
        <span>{t('settingsPanel.shortcuts.spatialNavigation.help')}</span>
      </div>
      <div className="settings-panel__control settings-panel__control--stack">
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
        <button
          type="button"
          className="secondary"
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
        </button>
      </div>
    </div>
  )

  return (
    <div className="settings-panel__section" id="settings-section-shortcuts">
      <h3 className="settings-panel__section-title">{t('settingsPanel.shortcuts.title')}</h3>

      <div className="settings-panel__row" id="settings-disable-shortcuts-terminal-focused">
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

      <div className="settings-panel__subsection" id="settings-section-keybindings">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">{t('settingsPanel.shortcuts.bindings')}</h4>
          <span>{t('settingsPanel.shortcuts.bindingsHelp')}</span>
        </div>

        {commandGroups.map(group => (
          <div key={group.id} className="settings-panel__subsection" style={{ marginTop: '12px' }}>
            <div className="settings-panel__subsection-header">
              <h4 className="settings-panel__section-title">{group.title}</h4>
              <span>{group.help}</span>
            </div>

            {group.commandIds.map(commandId => {
              const formatted = formatKeyChord(platform, effectiveBindings[commandId])
              const hasBinding = formatted.length > 0

              return (
                <div className="settings-panel__row" key={commandId}>
                  <div className="settings-panel__row-label">
                    <strong>{t(getCommandTitleKey(commandId))}</strong>
                    <span>{t(getCommandHelpKey(commandId))}</span>
                  </div>
                  <div className="settings-panel__control" style={{ gap: '8px', flexWrap: 'wrap' }}>
                    {hasBinding ? (
                      <KeybindingValue
                        platform={platform}
                        chord={effectiveBindings[commandId]}
                        formatted={formatted}
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
                    <button
                      type="button"
                      className="secondary"
                      style={shortcutButtonStyle}
                      data-testid={`settings-shortcut-record-${commandId}`}
                      onClick={() => {
                        setRecordingCommandId(current => (current === commandId ? null : commandId))
                      }}
                    >
                      {recordingCommandId === commandId
                        ? t('settingsPanel.shortcuts.recording')
                        : t('settingsPanel.shortcuts.record')}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      style={shortcutButtonStyle}
                      data-testid={`settings-shortcut-clear-${commandId}`}
                      onClick={() => {
                        onChangeKeybindings(
                          pruneOverrides(setOverride(keybindings, commandId, null)),
                        )
                      }}
                      disabled={
                        !hasBinding && !Object.prototype.hasOwnProperty.call(keybindings, commandId)
                      }
                    >
                      {t('settingsPanel.shortcuts.clear')}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      style={shortcutButtonStyle}
                      data-testid={`settings-shortcut-reset-${commandId}`}
                      onClick={() => {
                        onChangeKeybindings(pruneOverrides(removeOverride(keybindings, commandId)))
                      }}
                      disabled={!Object.prototype.hasOwnProperty.call(keybindings, commandId)}
                    >
                      {t('common.resetToDefault')}
                    </button>
                  </div>
                </div>
              )
            })}

            {group.id === 'workspaceCanvas' ? (
              <>
                {spatialNavigationSummary}
                {showSpatialNavigationBindings ? (
                  <div className="settings-panel__subsection settings-panel__subsection--spatial-nav">
                    {[...SPATIAL_NAVIGATION_NODE_COMMAND_IDS, ...SPATIAL_NAVIGATION_SPACE_COMMAND_IDS].map(
                      commandId => {
                        const formatted = formatKeyChord(platform, effectiveBindings[commandId])
                        const hasBinding = formatted.length > 0

                        return (
                          <div className="settings-panel__row" key={commandId}>
                            <div className="settings-panel__row-label">
                              <strong>{t(getCommandTitleKey(commandId))}</strong>
                              <span>{t(getCommandHelpKey(commandId))}</span>
                            </div>
                            <div
                              className="settings-panel__control"
                              style={{ gap: '8px', flexWrap: 'wrap' }}
                            >
                              {hasBinding ? (
                                <KeybindingValue
                                  platform={platform}
                                  chord={effectiveBindings[commandId]}
                                  formatted={formatted}
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
                              <button
                                type="button"
                                className="secondary"
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
                              </button>
                              <button
                                type="button"
                                className="secondary"
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
                              </button>
                              <button
                                type="button"
                                className="secondary"
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
                              </button>
                            </div>
                          </div>
                        )
                      },
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
