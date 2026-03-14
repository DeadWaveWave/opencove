type TerminalClipboardReader = {
  getSelection: () => string
  hasSelection: () => boolean
}

type PtyWriteQueue = {
  enqueue: (data: string) => void
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

export function handleTerminalCustomKeyEvent({
  copySelectedText = copyTextToClipboard,
  event,
  platformInfo,
  ptyWriteQueue,
  terminal,
}: {
  copySelectedText?: (text: string) => Promise<void> | void
  event: KeyboardEvent
  platformInfo?: PlatformInfo
  ptyWriteQueue: PtyWriteQueue
  terminal: TerminalClipboardReader
}): boolean {
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

  if (event.type !== 'keydown' || !isWindowsTerminalCopyShortcut(event, platformInfo)) {
    return true
  }

  if (!terminal.hasSelection()) {
    return true
  }

  const selection = terminal.getSelection()
  if (selection.length === 0) {
    return true
  }

  void copySelectedText(selection)
  return false
}

export function createPtyWriteQueue(write: (data: string) => Promise<void>): {
  enqueue: (data: string) => void
  flush: () => void
  dispose: () => void
} {
  let isDisposed = false
  const pendingChunks: string[] = []
  let pendingWrite: Promise<void> | null = null

  const flush = () => {
    if (isDisposed || pendingWrite || pendingChunks.length === 0) {
      return
    }

    const dataToWrite = pendingChunks.join('')
    pendingChunks.length = 0

    pendingWrite = write(dataToWrite)
      .catch(() => undefined)
      .finally(() => {
        pendingWrite = null
        flush()
      })
  }

  return {
    enqueue: data => {
      if (isDisposed || data.length === 0) {
        return
      }

      pendingChunks.push(data)
    },
    flush,
    dispose: () => {
      isDisposed = true
      pendingChunks.length = 0
      pendingWrite = null
    },
  }
}
