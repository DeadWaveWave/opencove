export const APP_COMMAND_IDS = [
  'commandCenter.toggle',
  'app.openSettings',
  'app.togglePrimarySidebar',
  'workspace.addProject',
] as const

export type AppCommandId = (typeof APP_COMMAND_IDS)[number]

export type KeyChord = {
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export type CommandKeybindings = {
  primary: KeyChord | null
  secondary: KeyChord | null
}

export type KeybindingOverrideSlots = {
  primary?: KeyChord | null
  secondary?: KeyChord | null
}

export type KeybindingOverrides = Partial<Record<AppCommandId, KeybindingOverrideSlots>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isModifierCode(code: string): boolean {
  return (
    code === 'ShiftLeft' ||
    code === 'ShiftRight' ||
    code === 'ControlLeft' ||
    code === 'ControlRight' ||
    code === 'MetaLeft' ||
    code === 'MetaRight' ||
    code === 'AltLeft' ||
    code === 'AltRight'
  )
}

export function hasNonShiftModifier(chord: KeyChord): boolean {
  return chord.metaKey || chord.ctrlKey || chord.altKey
}

export function toKeyChord(
  event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): KeyChord | null {
  if (typeof event.code !== 'string' || event.code.trim().length === 0) {
    return null
  }

  if (isModifierCode(event.code)) {
    return null
  }

  return {
    code: event.code,
    altKey: event.altKey === true,
    ctrlKey: event.ctrlKey === true,
    metaKey: event.metaKey === true,
    shiftKey: event.shiftKey === true,
  }
}

export function serializeKeyChord(chord: KeyChord): string {
  const mods = [
    chord.ctrlKey ? 'ctrl' : '',
    chord.altKey ? 'alt' : '',
    chord.shiftKey ? 'shift' : '',
    chord.metaKey ? 'meta' : '',
  ].filter(Boolean)

  return `${mods.join('+')}|${chord.code}`
}

export function isKeyChordEqual(a: KeyChord | null, b: KeyChord | null): boolean {
  if (!a || !b) {
    return a === b
  }

  return (
    a.code === b.code &&
    a.altKey === b.altKey &&
    a.ctrlKey === b.ctrlKey &&
    a.metaKey === b.metaKey &&
    a.shiftKey === b.shiftKey
  )
}

export function resolveDefaultKeybindings(
  platform: string | undefined,
): Record<AppCommandId, CommandKeybindings> {
  const isMac = platform === 'darwin'
  const commandModifier = isMac ? { metaKey: true } : { ctrlKey: true }

  return {
    'commandCenter.toggle': {
      primary: {
        code: 'KeyK',
        altKey: false,
        ctrlKey: !!commandModifier.ctrlKey,
        metaKey: !!commandModifier.metaKey,
        shiftKey: false,
      },
      secondary: {
        code: 'KeyP',
        altKey: false,
        ctrlKey: !!commandModifier.ctrlKey,
        metaKey: !!commandModifier.metaKey,
        shiftKey: false,
      },
    },
    'app.openSettings': {
      primary: {
        code: 'Comma',
        altKey: false,
        ctrlKey: !!commandModifier.ctrlKey,
        metaKey: !!commandModifier.metaKey,
        shiftKey: false,
      },
      secondary: null,
    },
    'app.togglePrimarySidebar': {
      primary: {
        code: 'KeyB',
        altKey: false,
        ctrlKey: !!commandModifier.ctrlKey,
        metaKey: !!commandModifier.metaKey,
        shiftKey: false,
      },
      secondary: null,
    },
    'workspace.addProject': {
      primary: {
        code: 'KeyO',
        altKey: false,
        ctrlKey: !!commandModifier.ctrlKey,
        metaKey: !!commandModifier.metaKey,
        shiftKey: false,
      },
      secondary: null,
    },
  }
}

export function resolveCommandKeybindings({
  commandId,
  overrides,
  platform,
}: {
  commandId: AppCommandId
  overrides: KeybindingOverrides | null | undefined
  platform: string | undefined
}): CommandKeybindings {
  const defaults = resolveDefaultKeybindings(platform)[commandId]
  const override = overrides?.[commandId] ?? null
  if (!override) {
    return defaults
  }

  return {
    primary: Object.prototype.hasOwnProperty.call(override, 'primary')
      ? (override.primary ?? null)
      : defaults.primary,
    secondary: Object.prototype.hasOwnProperty.call(override, 'secondary')
      ? (override.secondary ?? null)
      : defaults.secondary,
  }
}

export function resolveEffectiveKeybindings({
  overrides,
  platform,
}: {
  overrides: KeybindingOverrides | null | undefined
  platform: string | undefined
}): Record<AppCommandId, CommandKeybindings> {
  return APP_COMMAND_IDS.reduce(
    (acc, commandId) => {
      acc[commandId] = resolveCommandKeybindings({ commandId, overrides, platform })
      return acc
    },
    {} as Record<AppCommandId, CommandKeybindings>,
  )
}

function formatCodeLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice('Key'.length)
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.slice('Digit'.length)
  }

  switch (code) {
    case 'Comma':
      return ','
    case 'Period':
      return '.'
    case 'Slash':
      return '/'
    case 'Semicolon':
      return ';'
    case 'Quote':
      return "'"
    case 'BracketLeft':
      return '['
    case 'BracketRight':
      return ']'
    case 'Minus':
      return '-'
    case 'Equal':
      return '='
    case 'Backquote':
      return '`'
    case 'Space':
      return 'Space'
    case 'Escape':
      return 'Esc'
    case 'Enter':
      return 'Enter'
    case 'Tab':
      return 'Tab'
    case 'ArrowUp':
      return '↑'
    case 'ArrowDown':
      return '↓'
    case 'ArrowLeft':
      return '←'
    case 'ArrowRight':
      return '→'
    default:
      return code
  }
}

export function formatKeyChord(platform: string | undefined, chord: KeyChord | null): string {
  if (!chord) {
    return ''
  }

  const isMac = platform === 'darwin'
  const key = formatCodeLabel(chord.code)
  if (isMac) {
    const parts = [
      chord.ctrlKey ? '⌃' : '',
      chord.altKey ? '⌥' : '',
      chord.shiftKey ? '⇧' : '',
      chord.metaKey ? '⌘' : '',
    ].filter(Boolean)

    return `${parts.join('')}${key}`
  }

  const parts = [
    chord.ctrlKey ? 'Ctrl' : '',
    chord.altKey ? 'Alt' : '',
    chord.shiftKey ? 'Shift' : '',
    chord.metaKey ? 'Meta' : '',
  ].filter(Boolean)

  return `${[...parts, key].join(' ')}`
}

function normalizeKeyChord(value: unknown): KeyChord | null {
  if (value === null) {
    return null
  }

  if (!isRecord(value)) {
    return null
  }

  const code = typeof value.code === 'string' ? value.code.trim() : ''
  if (code.length === 0 || isModifierCode(code)) {
    return null
  }

  return {
    code,
    altKey: value.altKey === true,
    ctrlKey: value.ctrlKey === true,
    metaKey: value.metaKey === true,
    shiftKey: value.shiftKey === true,
  }
}

export function normalizeKeybindingOverrides(value: unknown): KeybindingOverrides {
  if (!isRecord(value)) {
    return {}
  }

  const overrides: KeybindingOverrides = {}

  for (const commandId of APP_COMMAND_IDS) {
    const raw = value[commandId]
    if (!isRecord(raw)) {
      continue
    }

    const entry: KeybindingOverrideSlots = {}

    if (Object.prototype.hasOwnProperty.call(raw, 'primary')) {
      entry.primary = normalizeKeyChord(raw.primary)
    }

    if (Object.prototype.hasOwnProperty.call(raw, 'secondary')) {
      entry.secondary = normalizeKeyChord(raw.secondary)
    }

    if (
      !Object.prototype.hasOwnProperty.call(entry, 'primary') &&
      !Object.prototype.hasOwnProperty.call(entry, 'secondary')
    ) {
      continue
    }

    overrides[commandId] = entry
  }

  return overrides
}
