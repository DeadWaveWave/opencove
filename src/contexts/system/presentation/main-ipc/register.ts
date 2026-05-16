import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, Notification, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent, SaveDialogOptions } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  ListSystemFontsResult,
  SaveTextToDownloadsInput,
  SaveTextToDownloadsResult,
  ShowSystemNotificationInput,
  ShowSystemNotificationResult,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import { createAppError } from '../../../../shared/errors/appError'

const NOTIFY_SEND_TIMEOUT_MS = 5_000
const MAX_DOWNLOAD_FILE_NAME_LENGTH = 180
const MAX_DOWNLOAD_TEXT_BYTES = 10 * 1024 * 1024
const DISALLOWED_DOWNLOAD_FILE_NAME_CHARACTERS = new Set([
  '<',
  '>',
  ':',
  '"',
  '/',
  '\\',
  '|',
  '?',
  '*',
])
const WINDOWS_RESERVED_FILE_STEMS = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

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

function hasUnsafeDownloadFileNameCharacter(value: string): boolean {
  for (const character of value) {
    if (DISALLOWED_DOWNLOAD_FILE_NAME_CHARACTERS.has(character) || character.charCodeAt(0) < 32) {
      return true
    }
  }

  return false
}

function normalizeDownloadFileName(value: unknown): string {
  if (typeof value !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid fileName for system:save-text-to-downloads.',
    })
  }

  const fileName = value.trim()
  const stem = fileName.slice(0, fileName.length - path.extname(fileName).length).toLowerCase()
  if (
    fileName.length === 0 ||
    fileName.length > MAX_DOWNLOAD_FILE_NAME_LENGTH ||
    fileName !== path.basename(fileName) ||
    hasUnsafeDownloadFileNameCharacter(fileName) ||
    /[. ]$/.test(fileName) ||
    WINDOWS_RESERVED_FILE_STEMS.has(stem)
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid fileName for system:save-text-to-downloads.',
    })
  }

  return fileName
}

function normalizeSaveTextToDownloadsPayload(payload: unknown): SaveTextToDownloadsInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for system:save-text-to-downloads.',
    })
  }

  const record = payload as Record<string, unknown>
  const fileName = normalizeDownloadFileName(record.fileName)
  if (typeof record.content !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid content for system:save-text-to-downloads.',
    })
  }

  if (Buffer.byteLength(record.content, 'utf8') > MAX_DOWNLOAD_TEXT_BYTES) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Content is too large for system:save-text-to-downloads.',
    })
  }

  return {
    fileName,
    content: record.content,
  }
}

function shouldBypassSaveDialog(): boolean {
  return Boolean(process.env.OPENCOVE_TEST_BYPASS_SAVE_DIALOG)
}

function resolveSaveDialogParent(event: IpcMainInvokeEvent): BrowserWindow | null {
  try {
    return BrowserWindow.fromWebContents(event.sender)
  } catch {
    return null
  }
}

function createSaveTextToDownloadsDialogOptions(fileName: string): SaveDialogOptions {
  return {
    defaultPath: path.join(app.getPath('downloads'), fileName),
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  }
}

async function resolveSaveTextToDownloadsPath(
  event: IpcMainInvokeEvent,
  fileName: string,
): Promise<string | null> {
  const options = createSaveTextToDownloadsDialogOptions(fileName)
  if (shouldBypassSaveDialog()) {
    return options.defaultPath ?? path.join(app.getPath('downloads'), fileName)
  }

  const parent = resolveSaveDialogParent(event)
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) {
    return null
  }

  return result.filePath
}

async function saveTextToDownloads(
  payload: SaveTextToDownloadsInput,
  event: IpcMainInvokeEvent,
): Promise<SaveTextToDownloadsResult> {
  const targetPath = await resolveSaveTextToDownloadsPath(event, payload.fileName)
  if (!targetPath) {
    return { status: 'canceled', fileName: payload.fileName, path: null }
  }

  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, payload.content, { encoding: 'utf8' })

  return {
    status: 'saved',
    fileName: path.basename(targetPath),
    path: targetPath,
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

async function showSystemNotification(
  payload: ShowSystemNotificationInput,
): Promise<ShowSystemNotificationResult> {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: payload.title,
      ...(payload.body ? { body: payload.body } : {}),
      silent: payload.silent ?? false,
    })

    notification.once('click', focusFirstAppWindow)
    notification.show()

    return { shown: true }
  }

  if (process.platform === 'linux') {
    const args: string[] = []
    if (payload.silent) {
      args.push('--urgency=low')
    }
    args.push(payload.title)
    if (payload.body) {
      args.push(payload.body)
    }

    return new Promise<ShowSystemNotificationResult>(resolve => {
      execFile(
        'notify-send',
        args,
        { timeout: NOTIFY_SEND_TIMEOUT_MS, windowsHide: true },
        error => {
          resolve({ shown: error === null })
        },
      )
    })
  }

  return { shown: false }
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

  registerHandledIpc(
    IPC_CHANNELS.systemSaveTextToDownloads,
    async (_event, payload): Promise<SaveTextToDownloadsResult> =>
      saveTextToDownloads(normalizeSaveTextToDownloadsPayload(payload), _event),
    { defaultErrorCode: 'common.unexpected' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.systemListFonts)
      ipcMain.removeHandler(IPC_CHANNELS.systemSaveTextToDownloads)
      ipcMain.removeHandler(IPC_CHANNELS.systemShowNotification)
    },
  }
}
