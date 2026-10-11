import { expect, type Page } from '@playwright/test'
import { stripVTControlCharacters } from 'node:util'
import { buildNodeEvalCommand } from './workspace-canvas.helpers'

export async function printTerminalLinkFixture(
  window: Page,
  nodeId: string,
  text: string,
  options: { mouseTracking?: boolean; inputResponses?: string[] } = {},
): Promise<void> {
  const visibleText = stripVTControlCharacters(text).replace(/\s+/g, '')
  if (!visibleText) {
    throw new Error('Terminal link fixtures must contain visible text')
  }
  const terminal = window.locator(`[data-id="${nodeId}"] .terminal-node`)
  const input = terminal.locator('.xterm-helper-textarea')
  await expect(input).toBeAttached()
  await terminal.locator('.xterm').click()
  await expect(input).toBeFocused()
  const mouseTracking = options.mouseTracking
    ? "process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',()=>process.stdout.write('\\r\\nPTY_MOUSE_INPUT'));process.stdout.write('\\x1b[?1000h\\x1b[?1006h');"
    : ''
  const inputResponses = options.inputResponses
    ? `const responses=${JSON.stringify(options.inputResponses)};process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',()=>process.stdout.write(responses.shift()||''));`
    : ''
  const script = `process.stdout.write('\\x1b[2J\\x1b[H'+${JSON.stringify(text)});${mouseTracking}${inputResponses}setInterval(()=>{},1000)`
  await window.keyboard.type(buildNodeEvalCommand(script))
  await window.keyboard.press('Enter')
  await expect
    .poll(() =>
      window.evaluate(
        // A shell prompt can share a path prefix. Wait for the complete output, including
        // soft-wrapped rows and OSC 8 labels, ignoring row padding and line breaks.
        ({ id, expected }) =>
          window.__opencoveTerminalSelectionTestApi
            ?.getBufferText(id, '')
            ?.viewportLines.join('')
            .replace(/\s+/g, '')
            .startsWith(expected) ?? false,
        { id: nodeId, expected: visibleText },
      ),
    )
    .toBe(true)
}

export async function terminalLinkCellPoint(
  window: Page,
  nodeId: string,
  col: number,
  row: number,
): Promise<{ x: number; y: number }> {
  return window
    .waitForFunction(
      ({ id, column, bufferRow }) => {
        const point = window.__opencoveTerminalSelectionTestApi?.getCellCenter(
          id,
          column,
          bufferRow,
        )
        if (!point || !document.elementFromPoint(point.x, point.y)?.closest('.xterm-screen')) {
          return null
        }
        return point
      },
      { id: nodeId, column: col, bufferRow: row },
    )
    .then(handle => handle.jsonValue())
}

export async function clearTerminalLinkSelection(window: Page, nodeId: string): Promise<void> {
  await window.evaluate(id => window.__opencoveTerminalSelectionTestApi?.clearSelection(id), nodeId)
}
