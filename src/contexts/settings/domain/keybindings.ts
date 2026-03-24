export const APP_COMMAND_IDS = [
  'commandCenter.toggle',
  'app.openSettings',
  'app.togglePrimarySidebar',
  'workspace.addProject',
  'workspace.search',
] as const

export const WORKSPACE_CANVAS_COMMAND_IDS = [
  'workspaceCanvas.createSpace',
  'workspaceCanvas.createNote',
  'workspaceCanvas.createTerminal',
  'workspaceCanvas.cycleSpacesForward',
  'workspaceCanvas.cycleSpacesBackward',
  'workspaceCanvas.cycleIdleSpacesForward',
  'workspaceCanvas.cycleIdleSpacesBackward',
] as const

export const COMMAND_IDS = [...APP_COMMAND_IDS, ...WORKSPACE_CANVAS_COMMAND_IDS] as const

export type AppCommandId = (typeof APP_COMMAND_IDS)[number]
export type WorkspaceCanvasCommandId = (typeof WORKSPACE_CANVAS_COMMAND_IDS)[number]
export type CommandId = (typeof COMMAND_IDS)[number]

export type KeyChord = {
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export type KeybindingOverrides = Partial<Record<CommandId, KeyChord | null>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function createCommandModifierChord(
  platform: string | undefined,
  code: KeyChord['code'],
  options?: Pick<KeyChord, 'shiftKey'>,
): KeyChord {
  const isMac = platform === 'darwin'

  return {
    code,
    altKey: false,
    ctrlKey: !isMac,
    metaKey: isMac,
    shiftKey: options?.shiftKey === true,
  }
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

export function isSupportedKeybindingChord(chord: KeyChord | null): chord is KeyChord {
  if (!chord) {
    return false
  }

  if (hasNonShiftModifier(chord)) {
    return true
  }

  return /^F\d+$/.test(chord.code)
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
): Record<CommandId, KeyChord | null> {
  return {
    'commandCenter.toggle': createCommandModifierChord(platform, 'KeyP'),
    'app.openSettings': createCommandModifierChord(platform, 'Comma'),
    'app.togglePrimarySidebar': createCommandModifierChord(platform, 'KeyB'),
    'workspace.addProject': createCommandModifierChord(platform, 'KeyO'),
    'workspace.search': createCommandModifierChord(platform, 'KeyF'),
    'workspaceCanvas.createSpace': createCommandModifierChord(platform, 'KeyG'),
    'workspaceCanvas.createNote': createCommandModifierChord(platform, 'KeyN'),
    'workspaceCanvas.createTerminal': createCommandModifierChord(platform, 'KeyT'),
    'workspaceCanvas.cycleSpacesForward': createCommandModifierChord(platform, 'BracketRight'),
    'workspaceCanvas.cycleSpacesBackward': createCommandModifierChord(platform, 'BracketLeft'),
    'workspaceCanvas.cycleIdleSpacesForward': createCommandModifierChord(platform, 'BracketRight', {
      shiftKey: true,
    }),
    'workspaceCanvas.cycleIdleSpacesBackward': createCommandModifierChord(platform, 'BracketLeft', {
      shiftKey: true,
    }),
  }
}

export function resolveCommandKeybinding({
  commandId,
  overrides,
  platform,
}: {
  commandId: CommandId
  overrides: KeybindingOverrides | null | undefined
  platform: string | undefined
}): KeyChord | null {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, commandId)) {
    return overrides[commandId] ?? null
  }

  return resolveDefaultKeybindings(platform)[commandId]
}

export function resolveEffectiveKeybindings({
  overrides,
  platform,
}: {
  overrides: KeybindingOverrides | null | undefined
  platform: string | undefined
}): Record<CommandId, KeyChord | null> {
  return COMMAND_IDS.reduce(
    (acc, commandId) => {
      acc[commandId] = resolveCommandKeybinding({ commandId, overrides, platform })
      return acc
    },
    {} as Record<CommandId, KeyChord | null>,
  )
}

export function createChordToCommandMap({
  platform,
  overrides,
  commandIds = COMMAND_IDS,
}: {
  platform: string | undefined
  overrides: KeybindingOverrides | null | undefined
  commandIds?: readonly CommandId[]
}): Map<string, CommandId> {
  const bindings = resolveEffectiveKeybindings({ platform, overrides })
  const map = new Map<string, CommandId>()

  for (const commandId of commandIds) {
    const chord = bindings[commandId]
    if (!chord) {
      continue
    }

    const serialized = serializeKeyChord(chord)
    if (!map.has(serialized)) {
      map.set(serialized, commandId)
    }
  }

  return map
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

  for (const commandId of COMMAND_IDS) {
    if (!Object.prototype.hasOwnProperty.call(value, commandId)) {
      continue
    }

    const raw = value[commandId]
    if (raw === null) {
      overrides[commandId] = null
      continue
    }

    const chord = normalizeKeyChord(raw)
    if (chord) {
      overrides[commandId] = chord
    }
  }

  return overrides
}
