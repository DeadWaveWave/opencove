import type { Terminal } from '@xterm/xterm'

type PtyWriteQueue = {
  enqueue: (data: string, encoding?: 'utf8' | 'binary') => void
  flush: () => void
}

type OscHandlerDisposable = { dispose: () => void }

type XtermOscParser = {
  registerOscHandler?: (
    identifier: number,
    callback: (data: string) => boolean,
  ) => OscHandlerDisposable
}

const ANSI_PALETTE_16 = [
  '#000000',
  '#cd0000',
  '#00cd00',
  '#cdcd00',
  '#0000ee',
  '#cd00cd',
  '#00cdcd',
  '#e5e5e5',
  '#7f7f7f',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#5c5cff',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
] as const

function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(255, Math.max(0, Math.round(value)))
}

function toHexByte(value: number): string {
  return clampByte(value).toString(16).padStart(2, '0')
}

function normalizeCssColorToHex(input: string | undefined | null): string | null {
  if (typeof input !== 'string') {
    return null
  }

  const value = input.trim()
  if (value.length === 0) {
    return null
  }

  if (value.startsWith('#')) {
    const hex = value.slice(1).trim()

    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      const expanded = hex
        .split('')
        .map(char => `${char}${char}`)
        .join('')
      return `#${expanded.toLowerCase()}`
    }

    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return `#${hex.toLowerCase()}`
    }

    if (/^[0-9a-fA-F]{8}$/.test(hex)) {
      return `#${hex.slice(0, 6).toLowerCase()}`
    }
  }

  const rgbMatch = value.match(/^rgba?\((.+)\)$/i)
  if (rgbMatch) {
    const parts = rgbMatch[1]?.split(',').map(part => part.trim()) ?? []
    if (parts.length < 3) {
      return null
    }

    const r = Number.parseFloat(parts[0] ?? '')
    const g = Number.parseFloat(parts[1] ?? '')
    const b = Number.parseFloat(parts[2] ?? '')
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
  }

  return null
}

function resolveTerminalThemeColor(terminal: Terminal, key: string): string | null {
  const theme = (terminal.options as unknown as { theme?: Record<string, unknown> }).theme
  if (!theme) {
    return null
  }

  return normalizeCssColorToHex(typeof theme[key] === 'string' ? (theme[key] as string) : null)
}

function sendOscResponse(ptyWriteQueue: PtyWriteQueue, sequence: string): void {
  ptyWriteQueue.enqueue(sequence)
  ptyWriteQueue.flush()
}

function resolvePaletteColor(index: number): string | null {
  const value = ANSI_PALETTE_16[index]
  return typeof value === 'string' ? value : null
}

function resolveSpecialColor(terminal: Terminal, identifier: number): string | null {
  switch (identifier) {
    case 10:
      return resolveTerminalThemeColor(terminal, 'foreground')
    case 11:
      return resolveTerminalThemeColor(terminal, 'background')
    case 12:
      return resolveTerminalThemeColor(terminal, 'cursor')
    case 13:
      return resolveTerminalThemeColor(terminal, 'foreground')
    case 14:
      return resolveTerminalThemeColor(terminal, 'background')
    case 15:
      return resolveTerminalThemeColor(terminal, 'foreground')
    case 16:
      return resolveTerminalThemeColor(terminal, 'background')
    case 17:
      return resolveTerminalThemeColor(terminal, 'selectionBackground')
    case 19:
      return resolveTerminalThemeColor(terminal, 'foreground')
    default:
      return null
  }
}

export function registerOpenCodeOscColorQueryResponder({
  terminal,
  ptyWriteQueue,
}: {
  terminal: Terminal
  ptyWriteQueue: PtyWriteQueue
}): () => void {
  const parser = (terminal as unknown as { parser?: XtermOscParser }).parser
  if (!parser || typeof parser.registerOscHandler !== 'function') {
    return () => undefined
  }

  const registerOscHandler = parser.registerOscHandler.bind(parser)
  const disposables: OscHandlerDisposable[] = []

  disposables.push(
    registerOscHandler(4, data => {
      const match = data.match(/^(\d+);\?$/)
      if (!match) {
        return false
      }

      const index = Number.parseInt(match[1] ?? '', 10)
      if (!Number.isFinite(index) || index < 0 || index >= 16) {
        return false
      }

      const color = resolvePaletteColor(index)
      if (!color) {
        return false
      }

      sendOscResponse(ptyWriteQueue, `\u001b]4;${index};${color}\u0007`)
      return true
    }),
  )

  const registerSpecialColorHandler = (identifier: number) => {
    disposables.push(
      registerOscHandler(identifier, data => {
        if (data.trim() !== '?') {
          return false
        }

        const color = resolveSpecialColor(terminal, identifier)
        if (!color) {
          return false
        }

        sendOscResponse(ptyWriteQueue, `\u001b]${identifier};${color}\u0007`)
        return true
      }),
    )
  }

  ;[10, 11, 12, 13, 14, 15, 16, 17, 19].forEach(registerSpecialColorHandler)

  return () => {
    disposables.forEach(disposable => disposable.dispose())
  }
}
