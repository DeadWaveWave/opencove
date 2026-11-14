import type { Terminal } from '@xterm/xterm'
import { SerializeAddon } from '@xterm/addon-serialize'

// Pinned xterm 6 adapter for state absent from its public API/SerializeAddon.
// Never write status queries here: a snapshot can bisect a provider CSI or OSC.
type TerminalStateInternals = {
  _core: {
    coreService: { isCursorHidden: boolean }
    coreMouseService: { activeEncoding: string }
    _bufferService: { buffer: { scrollTop: number; scrollBottom: number } }
  }
}

/** Read synchronously inside the presentation FIFO without advancing its parser. */
export function serializeTerminalState(terminal: Terminal, addon: SerializeAddon): string {
  // SerializeAddon owns cells, both buffers and its supported modes. It omits mouse
  // encoding, DECTCEM and scroll margins. Keep this read-only seam
  // small and covered by real-xterm round trips when upgrading xterm.
  const core = (terminal as unknown as TerminalStateInternals)._core
  const visible = !core.coreService.isCursorHidden
  const encoding =
    core.coreMouseService.activeEncoding === 'SGR_PIXELS'
      ? 1016
      : core.coreMouseService.activeEncoding === 'SGR'
        ? 1006
        : null
  const serialized = addon.serialize()
  let supplement = '\x1b[?1006l\x1b[?1016l'
  if (encoding !== null) {
    supplement += `\x1b[?${encoding}h`
  }
  supplement += visible ? '\x1b[?25h' : '\x1b[?25l'

  // Origin mode and DECSTBM home the cursor. CUP cannot encode x === cols:
  // repaint that same row with the addon's cell/style serialization to re-arm
  // pending wrap (including wide/combined glyphs), without an out-of-range CUP.
  const top = core._bufferService.buffer.scrollTop + 1,
    bottom = core._bufferService.buffer.scrollBottom + 1
  if (terminal.modes.originMode || top !== 1 || bottom !== terminal.rows) {
    const buffer = terminal.buffer.active
    const row = buffer.cursorY + 1 - (terminal.modes.originMode ? top - 1 : 0)
    supplement += `\x1b[${top};${bottom}r`
    if (buffer.cursorX >= terminal.cols) {
      const cursorRow = new SerializeAddon()
      // A read-only active-buffer view lets the range API serialize this row;
      // no source parser state or buffer is mutated to produce the checkpoint.
      cursorRow.activate({
        cols: terminal.cols,
        rows: terminal.rows,
        buffer: { normal: buffer },
        _core: core,
      } as unknown as Terminal)
      const line = buffer.baseY + buffer.cursorY
      // Range serialization starts from default SGR; its suffix restores the
      // source's current attributes after replaying the original cell styles.
      supplement += `\x1b[${row};1H\x1b[0m${cursorRow.serialize({
        range: { start: line, end: line },
        excludeAltBuffer: true,
        excludeModes: true,
      })}`
      cursorRow.dispose()
    } else {
      supplement += `\x1b[${row};${buffer.cursorX + 1}H`
    }
  }
  // The add-on omits modes whose value is the default. Establish those defaults
  // without clearing cells/history (also needed by the epoch-archiving path).
  const modeDefaults = '\x1b[!p\x1b[?9;1000;1002;1003l'
  return modeDefaults + serialized + supplement
}
