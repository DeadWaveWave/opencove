import { BrowserWindow, Notification, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  ListSystemFontsResult,
  ShowSystemNotificationInput,
  ShowSystemNotificationResult,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import { createAppError } from '../../../../shared/errors/appError'

const MONOSPACE_KEYWORDS = [
  'mono',
  'monospace',
  'courier',
  'console',
  'typewriter',
  'fixed',
  'code',
  'terminal',
  'nerd font',
  ' nf',
  ' nf ',
  'powerline',
  'cascadia',
  'jetbrains',
  'fira code',
  'source code',
  'inconsolata',
  'hack',
  'deja vu sans mono',
  'liberation mono',
  'ubuntu mono',
  'roboto mono',
  'iosevka',
  'meslo',
  'anonymous pro',
  'input mono',
  'space mono',
  'office code pro',
  'envy code',
  'proggy',
  'lucida console',
  'lucida sans typewriter',
  'andale mono',
]

function isLikelyMonospace(name: string): boolean {
  const lower = name.toLowerCase()
  return MONOSPACE_KEYWORDS.some(kw => lower.includes(kw))
}

function stripQuotes(name: string): string {
  if (name.startsWith('"') && name.endsWith('"')) {
    return name.slice(1, -1)
  }
  return name
}

async function listSystemFonts(): Promise<ListSystemFontsResult> {
  try {
    const fontList = await import('font-list')
    const raw: string[] = await fontList.getFonts({ disableQuoting: false })
    const seen = new Set<string>()
    const fonts = raw
      .map(name => stripQuotes(name).trim())
      .filter(name => {
        if (!name || seen.has(name)) {
          return false
        }
        seen.add(name)
        return true
      })
      .map(name => ({ name, monospace: isLikelyMonospace(name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { fonts }
  } catch {
    return { fonts: [] }
  }
}

function normalizeNotificationText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeShowSystemNotificationPayload(payload: unknown): ShowSystemNotificationInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for system:show-notification.',
    })
  }

  const record = payload as Record<string, unknown>
  const title = normalizeNotificationText(record.title, 120)
  if (title.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid title for system:show-notification.',
    })
  }

  const body = normalizeNotificationText(record.body, 500)
  const silent = typeof record.silent === 'boolean' ? record.silent : false

  return {
    title,
    body: body.length > 0 ? body : null,
    silent,
  }
}

function focusFirstAppWindow(): void {
  const target = BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
  if (!target) {
    return
  }

  if (target.isMinimized()) {
    target.restore()
  }

  target.show()
  target.focus()
}

function showSystemNotification(
  payload: ShowSystemNotificationInput,
): ShowSystemNotificationResult {
  if (!Notification.isSupported()) {
    return { shown: false }
  }

  const notification = new Notification({
    title: payload.title,
    ...(payload.body ? { body: payload.body } : {}),
    silent: payload.silent ?? false,
  })

  notification.once('click', focusFirstAppWindow)
  notification.show()

  return { shown: true }
}

export function registerSystemIpcHandlers(): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.systemListFonts,
    async (): Promise<ListSystemFontsResult> => listSystemFonts(),
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.systemShowNotification,
    async (_event, payload): Promise<ShowSystemNotificationResult> =>
      showSystemNotification(normalizeShowSystemNotificationPayload(payload)),
    { defaultErrorCode: 'common.unexpected' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.systemListFonts)
      ipcMain.removeHandler(IPC_CHANNELS.systemShowNotification)
    },
  }
}
