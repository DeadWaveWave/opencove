import React from 'react'
import {
  formatKeyChord,
  formatKeyChordParts,
  type CommandId,
  type FormattedKeyChordParts,
  type KeyChord,
} from '@contexts/settings/domain/keybindings'

export const SPATIAL_NAVIGATION_NODE_COMMAND_IDS: CommandId[] = [
  'workspaceCanvas.navigateNodeLeft',
  'workspaceCanvas.navigateNodeRight',
  'workspaceCanvas.navigateNodeUp',
  'workspaceCanvas.navigateNodeDown',
]

export const SPATIAL_NAVIGATION_SPACE_COMMAND_IDS: CommandId[] = [
  'workspaceCanvas.navigateSpaceLeft',
  'workspaceCanvas.navigateSpaceRight',
  'workspaceCanvas.navigateSpaceUp',
  'workspaceCanvas.navigateSpaceDown',
]

export function isSpatialNavigationCommandId(commandId: CommandId): boolean {
  return (
    commandId.startsWith('workspaceCanvas.navigateNode') ||
    commandId.startsWith('workspaceCanvas.navigateSpace')
  )
}

function joinKeyChordPartsText(
  platform: string | undefined,
  parts: FormattedKeyChordParts,
): string {
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
  const tokenOccurrences = new Map<string, number>()
  const tokenEntries = tokens.map(token => {
    const occurrence = tokenOccurrences.get(token) ?? 0
    tokenOccurrences.set(token, occurrence + 1)

    return {
      token,
      key: occurrence === 0 ? token : `${token}-${occurrence + 1}`,
    }
  })

  return (
    <span className="settings-panel__keybinding" aria-label={ariaLabel}>
      {tokenEntries.map(entry => (
        <span key={entry.key} className="settings-panel__keycap">
          {entry.token}
        </span>
      ))}
    </span>
  )
}

export function KeybindingValue({
  platform,
  chord,
  testId,
}: {
  platform: string | undefined
  chord: KeyChord
  testId: string
}): React.JSX.Element {
  const formatted = formatKeyChord(platform, chord)
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

export function SpatialNavigationPreviewGroup({
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
    partsList.length > 0 &&
    partsList.every(parts => areStringArraysEqual(parts.modifiers, partsList[0].modifiers))
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
