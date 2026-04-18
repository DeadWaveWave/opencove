import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { ListSystemFontsResult } from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'

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

export function registerSystemIpcHandlers(): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.systemListFonts,
    async (): Promise<ListSystemFontsResult> => listSystemFonts(),
    { defaultErrorCode: 'common.unexpected' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.systemListFonts)
    },
  }
}
