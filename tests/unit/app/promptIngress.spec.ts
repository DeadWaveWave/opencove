import { describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { BracketedPasteIngressTracker } from '../../../src/app/main/controlSurface/ptyStream/BracketedPasteIngressTracker'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

// The installed xterm browser package runs its parser without a DOM/open(), like headless.
// Both packages share InputHandler/CoreService; no new dependency is required.
describe('bracketed paste ingress parity', () => {
  it.each([
    '\x1b[?2004h',
    '\x1b[?2004h\x1b[?2004\ufeffl',
    '\x1b[?1;2004;1004h',
    '\x1b[?2004h\x1b[?1;2004l',
    '\x1b[?2004h\x1bc',
    '\x1b[?2004h\x1b[!p',
    '\x1b]title\x1b[?2004h\x07',
    '\x1b[?2004h\x1b[?2004l\x1b[?2004h',
  ])('matches xterm at every split for %#', async sequence => {
    for (let split = 0; split <= sequence.length; split++) {
      const tracker = new BracketedPasteIngressTracker()
      const terminal = new Terminal({ allowProposedApi: true })
      for (const chunk of [sequence.slice(0, split), sequence.slice(split)]) {
        if (!chunk) {
          continue
        }
        tracker.feed(chunk)
        // Parser fragments must be applied in order to compare intermediate modes.
        await new Promise<void>(resolve => terminal.write(chunk, resolve))
        expect(tracker.bracketedPaste).toBe(terminal.modes.bracketedPasteMode)
      }
      terminal.dispose()
    }
  })
  it('tracks all bytes before Hub buffering/truncation and reserves a non-reentrant raw writer', async () => {
    const write = vi.fn()
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64000,
      ptyRuntime: {
        write,
        spawnSession: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: () => () => {},
        onExit: () => () => {},
      },
    })
    hub.handlePtyData('s', '\x1b[?1;2004h' + 'x'.repeat(300000))
    let saved!: (text: string) => void
    await hub.withSessionInputOperation('s', async input => {
      expect(input.mode()).toMatchObject({ bracketedPaste: true, watermark: 300010 })
      await expect(hub.withSessionInputOperation('s', async () => {})).rejects.toThrow(
        'non-reentrant',
      )
      input.write('one')
      saved = input.write
    })
    expect(() => saved('late')).toThrow('expired')
    expect(write).toHaveBeenCalledExactlyOnceWith('s', 'one')
    const before = await hub.presentationSnapshotSession('s')
    await hub.replaceSessionPresentationCurrent({ sessionId: 's', snapshot: before })
    await hub.withSessionInputOperation('s', async input => {
      expect(input.mode()).toEqual({ bracketedPaste: false, watermark: 0 })
    })
    hub.forgetSession('s')
    hub.handlePtyData('s', 'new epoch')
    await hub.withSessionInputOperation('s', async input => {
      expect(input.mode().bracketedPaste).toBe(false)
    })
    hub.forgetSession('s')
  })
})

it.each([
  ['parameterized DECSTR', '\x1b[0!p'],
  ['DEL in DECRST', '\x1b[?2004\x7fl'],
  ['NUL in RIS', '\x1b\x00c'],
  ['C1 CSI inside OSC', '\x1b]title\x9b?2004l'],
])('regression: %s disables paste at every split', async (_name, reset) => {
  const sequence = '\x1b[?2004h' + reset
  const comparisons: Promise<void>[] = []
  for (let split = 0; split <= sequence.length; split++) {
    const tracker = new BracketedPasteIngressTracker(),
      terminal = new Terminal({ allowProposedApi: true })
    for (const chunk of [sequence.slice(0, split), sequence.slice(split)]) {
      tracker.feed(chunk)
      const expected = tracker.bracketedPaste
      comparisons.push(
        new Promise(resolve =>
          terminal.write(chunk, () => {
            expect(terminal.modes.bracketedPasteMode).toBe(expected)
            resolve()
          }),
        ),
      )
    }
    comparisons.push(
      new Promise(resolve =>
        terminal.write('', () => {
          expect(tracker.bracketedPaste).toBe(false)
          terminal.dispose()
          resolve()
        }),
      ),
    )
  }
  await Promise.all(comparisons)
})

it('seeded VT500 randomized parity after every chunk (4000 sequences)', async () => {
  let seed = 0x2b500
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  const tokens = [
    '\x1b',
    '[',
    '\x1b[',
    '?2004h',
    '?2004l',
    '?1;2004;1004h',
    '!p',
    '0!p',
    'c',
    '\0',
    '\x7f',
    '\x18',
    '\x1a',
    '\x1b]',
    '\x1bP',
    '\x1bX',
    '\x1b^',
    '\x1b_',
    '\x07',
    '\x1b\\',
    '\x90',
    '\x98',
    '\x99',
    '\x9a',
    '\x9b',
    '\x9c',
    '\x9d',
    '\x9e',
    '\x9f',
    '\x85',
    'text',
    '😀',
    '\ufeff',
    '\ud800',
    '\udc00',
    '中',
    ' :;0?!',
    '\x1b[?2004h',
    '\x1b[?2004l',
    '\x1b[0!p',
  ]
  const tracker = new BracketedPasteIngressTracker(),
    terminal = new Terminal({ allowProposedApi: true, scrollback: 0 })
  const comparisons: Promise<void>[] = []
  for (let index = 0; index < 4000; index++) {
    let sequence = ''
    const length = 2 + (random() % 14)
    for (let token = 0; token < length; token++) {
      sequence += tokens[random() % tokens.length]
    }
    for (let start = 0; start < sequence.length; ) {
      const end = start + 1 + (random() % 11),
        chunk = sequence.slice(start, end)
      tracker.feed(chunk)
      const expected = tracker.bracketedPaste,
        label = `seed=0x2b500 sequence=${index} offset=${start}`
      comparisons.push(
        new Promise((resolve, reject) =>
          terminal.write(chunk, () => {
            try {
              expect(terminal.modes.bracketedPasteMode, label).toBe(expected)
              resolve()
            } catch (error) {
              reject(error)
            }
          }),
        ),
      )
      start = end
    }
  }
  try {
    await Promise.all(comparisons)
  } finally {
    terminal.dispose()
  }
}, 30000)

it('matches xterm for long mixed printable runs without allocating byte arrays at ingress', async () => {
  const tracker = new BracketedPasteIngressTracker(),
    terminal = new Terminal({ allowProposedApi: true, scrollback: 0 })
  const run = 'plain ASCII 0123456789 '.repeat(12000)
  const chunks = [
    run,
    '\x1b[?2004h' + run + '\x1b[0!p' + run,
    '\x1b]title ' + run,
    '\x9b?2004h' + run + '\r\n' + run,
    '😀' + run + '\x1b[?2004l' + run,
  ]
  const encoder = vi.spyOn(TextEncoder.prototype, 'encode')
  const expected = chunks.map(chunk => {
    tracker.feed(chunk)
    return tracker.bracketedPaste
  })
  expect(encoder).not.toHaveBeenCalled()
  encoder.mockRestore()
  try {
    await Promise.all(
      chunks.map(
        (chunk, i) =>
          new Promise<void>((resolve, reject) =>
            terminal.write(chunk, () => {
              try {
                expect(terminal.modes.bracketedPasteMode).toBe(expected[i])
                resolve()
              } catch (error) {
                reject(error)
              }
            }),
          ),
      ),
    )
    expect(tracker.watermark).toBe(chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk), 0))
  } finally {
    terminal.dispose()
  }
})
