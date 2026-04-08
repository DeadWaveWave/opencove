import { SearchAddon } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'

export function maybeBindTerminalSearchAddon({
  terminal,
  bindSearchAddonToFind,
}: {
  terminal: Terminal
  bindSearchAddonToFind: (addon: SearchAddon) => () => void
}): () => void {
  if (typeof (terminal as unknown as { onWriteParsed?: unknown }).onWriteParsed !== 'function') {
    return () => undefined
  }

  const searchAddon = new SearchAddon()
  terminal.loadAddon(searchAddon)
  return bindSearchAddonToFind(searchAddon)
}
