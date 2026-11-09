import { afterEach, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'
import {
  observeTerminalWritesForTest,
  readTerminalEmulationStateForTest,
  readTerminalWritesForTest,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalRenderTestProbe'

const disposables: Array<() => void> = []
afterEach(() =>
  disposables
    .splice(0)
    .reverse()
    .forEach(dispose => dispose()),
)
const write = (terminal: Terminal, data: string) =>
  new Promise<void>(resolve => terminal.write(data, resolve))
function createTerminal() {
  const value = new Terminal({ allowProposedApi: true })
  disposables.push(() => value.dispose())
  return value
}

it('reads actual active buffer, public modes, mouse encoding and cursor visibility', async () => {
  const value = createTerminal()
  await write(value, '\x1b[?1049h\x1b[?2004h\x1b[?1003h\x1b[?1006h\x1b[?1h\x1b[?25l')
  expect(readTerminalEmulationStateForTest(value)).toEqual({
    bufferKind: 'alternate',
    bracketedPasteMode: true,
    applicationCursorKeysMode: true,
    applicationKeypadMode: false,
    sendFocusMode: false,
    originMode: false,
    wraparoundMode: true,
    mouseTrackingMode: 'any',
    mouseEncoding: 'SGR',
    cursorVisible: false,
  })
})

it('captures exact writes/callbacks with shared-owner cleanup and no duplicate interception', async () => {
  const value = createTerminal()
  const original = value.write
  const first = observeTerminalWritesForTest(value)
  const second = observeTerminalWritesForTest(value)
  disposables.push(first, second)
  first()
  await write(value, '\x1bcvisible')
  expect(value.buffer.active.getLine(0)?.translateToString(true)).toBe('visible')
  expect(readTerminalWritesForTest(value)).toEqual([
    { at: expect.any(Number), data: '\x1bcvisible', containsRIS: true, truncated: false },
  ])
  second()
  expect(value.write).toBe(original)
  expect(readTerminalWritesForTest(value)).toEqual([])
})

it('bounds diagnostic data without losing an oversized write reset flag', async () => {
  const value = createTerminal()
  const dispose = observeTerminalWritesForTest(value)
  disposables.push(dispose)
  await write(value, '\x1bc' + 'x'.repeat(260_000))
  const [record] = readTerminalWritesForTest(value)
  expect(record?.data.length).toBe(256_000)
  expect(record?.containsRIS).toBe(true)
  expect(record?.truncated).toBe(true)
})
