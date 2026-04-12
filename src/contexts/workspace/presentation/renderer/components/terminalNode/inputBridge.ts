import type { WindowsAutomationPasteGuard } from './windowsAutomationPasteGuard'

type PtyWriteEncoding = 'utf8' | 'binary'

type PtyWritePayload = {
  data: string
  encoding: PtyWriteEncoding
}

type TerminalClipboardController = {
  clearSelection?: () => void
  getSelection: () => string
  hasSelection: () => boolean
  paste: (data: string) => void
}

type PtyWriteQueue = {
  enqueue: (data: string, encoding?: PtyWriteEncoding) => void
  flush: () => void
}

type PlatformInfo = {
  platform?: string
  userAgent?: string
}

export function isWindowsPlatform(platformInfo: PlatformInfo | undefined = navigator): boolean {
  if (!platformInfo) {
    return false
  }

  return /win/i.test(platformInfo.platform ?? '') || /windows/i.test(platformInfo.userAgent ?? '')
}

export function isLinuxPlatform(platformInfo: PlatformInfo | undefined = navigator): boolean {
  if (!platformInfo) {
    return false
  }

  return /linux/i.test(platformInfo.platform ?? '') || /linux/i.test(platformInfo.userAgent ?? '')
}

export function isWindowsTerminalCopyShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  platformInfo: PlatformInfo | undefined = navigator,
): boolean {
  return (
    isWindowsPlatform(platformInfo) &&
    event.key.toLowerCase() === 'c' &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  )
}

export function isWindowsTerminalPasteShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  platformInfo: PlatformInfo | undefined = navigator,
): boolean {
  if (!isWindowsPlatform(platformInfo) || event.metaKey || event.altKey) {
    return false
  }

  if (event.key.toLowerCase() === 'v') {
    return event.ctrlKey && !event.shiftKey
  }

  return event.key === 'Insert' && event.shiftKey && !event.ctrlKey
}

export function isMacPlatform(platformInfo: PlatformInfo | undefined = navigator): boolean {
  if (!platformInfo) {
    return false
  }

  return /mac/i.test(platformInfo.platform ?? '') || /macintosh/i.test(platformInfo.userAgent ?? '')
}

export function isMacTerminalPasteShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  platformInfo: PlatformInfo | undefined = navigator,
): boolean {
  if (!isMacPlatform(platformInfo) || event.ctrlKey || event.altKey) {
    return false
  }

  return event.key.toLowerCase() === 'v' && event.metaKey && !event.shiftKey
}

export function isLinuxTerminalCopyShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  platformInfo: PlatformInfo | undefined = navigator,
): boolean {
  return (
    isLinuxPlatform(platformInfo) &&
    event.key.toLowerCase() === 'c' &&
    event.ctrlKey &&
    event.shiftKey &&
    !event.metaKey &&
    !event.altKey
  )
}

export function isLinuxTerminalPasteShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  platformInfo: PlatformInfo | undefined = navigator,
): boolean {
  return (
    isLinuxPlatform(platformInfo) &&
    event.key.toLowerCase() === 'v' &&
    event.ctrlKey &&
    event.shiftKey &&
    !event.metaKey &&
    !event.altKey
  )
}

function isTerminalFindShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>,
): boolean {
  if (event.altKey) {
    return false
  }

  if (!(event.metaKey || event.ctrlKey)) {
    return false
  }

  return event.key.toLowerCase() === 'f'
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (text.length === 0) {
    return
  }

  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Fall back to execCommand for Electron environments where Clipboard API is unavailable.
  }

  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  textarea.style.top = '0'
  textarea.style.left = '0'

  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.body.append(textarea)
  textarea.focus()
  textarea.select()

  try {
    document.execCommand('copy')
  } finally {
    textarea.remove()
    activeElement?.focus()
  }
}

export async function readTextFromClipboard(): Promise<string> {
  if (
    typeof window !== 'undefined' &&
    typeof window.opencoveApi?.clipboard?.readText === 'function'
  ) {
    try {
      return await window.opencoveApi.clipboard.readText()
    } catch {
      // Fall through to the browser Clipboard API.
    }
  }

  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.readText !== 'function'
  ) {
    return ''
  }

  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

export async function pasteTextFromClipboard({
  readClipboardText = readTextFromClipboard,
  terminal,
}: {
  readClipboardText?: () => Promise<string> | string
  terminal: Pick<TerminalClipboardController, 'paste'>
}): Promise<void> {
  const text = await readClipboardText()
  if (text.length === 0) {
    return
  }

  terminal.paste(text)
}

export function handleTerminalCustomKeyEvent({
  automationPasteGuard,
  copySelectedText = copyTextToClipboard,
  event,
  pasteClipboardText = pasteTextFromClipboard,
  onOpenFind,
  platformInfo,
  ptyWriteQueue,
  terminal,
}: {
  automationPasteGuard?: WindowsAutomationPasteGuard | null
  copySelectedText?: (text: string) => Promise<void> | void
  event: KeyboardEvent
  pasteClipboardText?: (
    options: Pick<Parameters<typeof pasteTextFromClipboard>[0], 'terminal'>,
  ) => Promise<void> | void
  onOpenFind?: () => void
  platformInfo?: PlatformInfo
  ptyWriteQueue: PtyWriteQueue
  terminal: TerminalClipboardController
}): boolean {
  const windowsCopyShortcut = isWindowsTerminalCopyShortcut(event, platformInfo)
  const windowsPasteShortcut = isWindowsTerminalPasteShortcut(event, platformInfo)
  const linuxCopyShortcut = isLinuxTerminalCopyShortcut(event, platformInfo)
  const linuxPasteShortcut = isLinuxTerminalPasteShortcut(event, platformInfo)
  const macPasteShortcut = isMacTerminalPasteShortcut(event, platformInfo)
  const isPhysicalKeyCodeMissing = typeof event.code !== 'string' || event.code.length === 0

  if (event.type === 'keydown' || event.type === 'keyup') {
    automationPasteGuard?.noteKeyboardEvent({
      type: event.type,
      key: event.key,
      code: event.code || null,
      repeat: event.repeat,
    })
  }

  if (
    event.key === 'Enter' &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    if (event.type === 'keydown') {
      ptyWriteQueue.enqueue('\u001b\r')
      ptyWriteQueue.flush()
    }

    return false
  }

  if (event.type === 'keydown' && isTerminalFindShortcut(event)) {
    event.preventDefault()
    event.stopPropagation()
    onOpenFind?.()
    return false
  }

  if (
    event.type === 'keydown' &&
    (windowsPasteShortcut || macPasteShortcut || linuxPasteShortcut)
  ) {
    const canceledPendingInterrupt = automationPasteGuard?.cancelPendingInterrupt() ?? false
    if (canceledPendingInterrupt && terminal.hasSelection()) {
      terminal.clearSelection?.()
    }
    event.preventDefault()
    event.stopPropagation()
    void pasteClipboardText({ terminal })
    return false
  }

  if (
    event.type !== 'keydown' ||
    (!windowsCopyShortcut && !linuxCopyShortcut)
  ) {
    return true
  }

  if (!terminal.hasSelection()) {
    if (automationPasteGuard && windowsCopyShortcut && isPhysicalKeyCodeMissing) {
      event.preventDefault()
      event.stopPropagation()
      automationPasteGuard.scheduleInterrupt()
      return false
    }
    return true
  }

  const selection = terminal.getSelection()
  if (selection.length === 0) {
    return true
  }

  if (automationPasteGuard?.shouldSuppressSelectionCopy()) {
    event.preventDefault()
    event.stopPropagation()
    terminal.clearSelection?.()
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  void copySelectedText(selection)
  return false
}

export function createPtyWriteQueue(write: (payload: PtyWritePayload) => Promise<void>): {
  enqueue: (data: string, encoding?: PtyWriteEncoding) => void
  flush: () => void
  dispose: () => void
} {
  let isDisposed = false
  const pendingWrites: PtyWritePayload[] = []
  let pendingWrite: Promise<void> | null = null

  const takeNextPayload = (): PtyWritePayload | null => {
    const firstPayload = pendingWrites.shift()
    if (!firstPayload) {
      return null
    }

    let data = firstPayload.data
    while (pendingWrites.length > 0 && pendingWrites[0]?.encoding === firstPayload.encoding) {
      data += pendingWrites.shift()?.data ?? ''
    }

    return {
      data,
      encoding: firstPayload.encoding,
    }
  }

  const flush = () => {
    if (isDisposed || pendingWrite) {
      return
    }

    const nextPayload = takeNextPayload()
    if (!nextPayload) {
      return
    }

    pendingWrite = write(nextPayload)
      .catch(() => undefined)
      .finally(() => {
        pendingWrite = null
        flush()
      })
  }

  return {
    enqueue: (data, encoding = 'utf8') => {
      if (isDisposed || data.length === 0) {
        return
      }

      pendingWrites.push({ data, encoding })
    },
    flush,
    dispose: () => {
      isDisposed = true
      pendingWrites.length = 0
      pendingWrite = null
    },
  }
}
