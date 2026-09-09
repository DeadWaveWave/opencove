import type { TerminalClipboardSnapshot } from '@shared/contracts/dto'
import {
  isLinuxTerminalPasteShortcut,
  isMacTerminalPasteShortcut,
  isWindowsTerminalPasteShortcut,
  pasteTextFromClipboard,
  readTextFromClipboard,
} from './inputBridge'

export function resolveTerminalImagePasteSequence(
  provider: string | null,
  platform: string,
): string {
  // Pi changed its Windows default to Alt+V; Kimi still binds Ctrl+V.
  return platform === 'win32' && (provider === 'pi' || provider === 'claude-code')
    ? '\u001bv'
    : '\u0016'
}

export function createTerminalClipboardHandler(options: {
  provider: string | null
  getProvider?: () => string | null
  platform: string
  readClipboard?: () => Promise<TerminalClipboardSnapshot>
  write: (data: string) => void
  isBracketedPasteMode: () => boolean
  isDisposed: () => boolean
}): (event: KeyboardEvent) => boolean {
  let pending = Promise.resolve()
  const platformInfo = { platform: options.platform === 'darwin' ? 'MacIntel' : options.platform }
  const readClipboard =
    options.readClipboard ??
    (async () => {
      const clipboard = window.opencoveApi?.clipboard
      return typeof clipboard?.readTerminalPaste === 'function'
        ? await clipboard.readTerminalPaste()
        : { text: await readTextFromClipboard(), hasImage: false }
    })

  return event => {
    if (event.type !== 'keydown') {
      return false
    }
    const provider = options.getProvider ? options.getProvider() : options.provider
    const isNativeAlias =
      options.platform === 'win32' &&
      provider !== null &&
      ['pi', 'kimi', 'codex', 'claude-code'].includes(provider) &&
      event.key.toLowerCase() === 'v' &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    if (
      !isNativeAlias &&
      !isWindowsTerminalPasteShortcut(event, platformInfo) &&
      !isMacTerminalPasteShortcut(event, platformInfo) &&
      !isLinuxTerminalPasteShortcut(event, platformInfo)
    ) {
      return false
    }

    event.preventDefault()
    event.stopPropagation()
    if (isNativeAlias) {
      if (!options.isDisposed()) {
        options.write(resolveTerminalImagePasteSequence(provider, options.platform))
      }
      return true
    }
    // Start reading at the gesture; serialize only delivery so repeated pastes keep order.
    const snapshot = Promise.resolve()
      .then(readClipboard)
      .catch(() => null)
    pending = pending
      .then(async () => {
        const clipboard = await snapshot
        if (!clipboard || options.isDisposed()) {
          return
        }
        if (clipboard.hasImage) {
          if (options.getProvider && options.getProvider() !== provider) {
            return
          }
          options.write(resolveTerminalImagePasteSequence(provider, options.platform))
          return
        }
        await pasteTextFromClipboard({
          readClipboardText: () => clipboard.text,
          writePastePayload: data => {
            if (!options.isDisposed()) {
              options.write(data)
            }
          },
          isBracketedPasteMode: options.isBracketedPasteMode,
        })
      })
      .catch(() => undefined)
    return true
  }
}
