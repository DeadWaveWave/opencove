// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'
import { replayScreen } from '../../../src/app/cli/core/screenReplay'

it.each(['agent', 'terminal'])(
  'reads real Worker-style %s scrollback beyond the viewport',
  async kind => {
    const session = new TerminalPresentationSession({ sessionId: 's', cols: 80, rows: 4 })
    try {
      await session.applyOutput(
        1,
        Array.from({ length: 250 }, (_, i) => `\x1b[31mLine ${i}\x1b[0m`).join('\r\n'),
      )
      const snapshot = await session.snapshot()
      expect(replayScreen(snapshot)).toEqual(['Line 246', 'Line 247', 'Line 248', 'Line 249'])
      const f = identityFixture(false)
      f.values['node.get'] = { node: { ...node, kind } }
      f.values['session.get'] = { sessionId: 's' }
      f.values['session.presentationSnapshot'] = snapshot
      expect(
        await run(['agent', 'read', '--node', node.id, '--scrollback', '-o', 'json'], f.io),
      ).toBe(0)
      expect(JSON.parse(f.out()).lines).toEqual(
        Array.from({ length: 200 }, (_, i) => `Line ${i + 50}`),
      )
    } finally {
      session.dispose()
    }
  },
)
it.each(
  [
    ['--scrollback', '--screen'],
    ['--scrollback', '--turn', 't'],
    ['--scrollback', '--last'],
    ['--scrollback', '--lines', '5001'],
  ].map(flags => ({ flags })),
)('rejects incompatible scrollback flags: $flags', async ({ flags }) => {
  const f = identityFixture(false)
  expect(await run(['agent', 'read', '--node', node.id, ...flags], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})

it('reads alternate buffers without exposing normal history and honors an empty screen', async () => {
  const session = new TerminalPresentationSession({ sessionId: 'alternate', cols: 20, rows: 3 })
  try {
    await session.applyOutput(1, 'secret\r\none\r\ntwo\r\nthree\x1b[?1049h\x1b[HALT')
    expect(replayScreen(await session.snapshot(), 5000)).toEqual(['ALT'])
    await session.applyOutput(2, '\x1b[2J\x1b[H')
    expect(replayScreen(await session.snapshot(), 5000)).toEqual([])
  } finally {
    session.dispose()
  }
})

it('clears retained rows when the snapshot clears scrollback', () => {
  expect(
    replayScreen(
      { cols: 10, rows: 2, bufferKind: 'normal', serializedScreen: 'old\r\none\r\ntwo\x1b[3J' },
      5000,
    ),
  ).toEqual(['one', 'two'])
})

it('bounds the retained history while keeping the latest visible rows', async () => {
  const session = new TerminalPresentationSession({ sessionId: 'bounded', cols: 40, rows: 4 })
  try {
    await session.applyOutput(1, Array.from({ length: 5100 }, (_, i) => `Line ${i}`).join('\r\n'))
    const f = identityFixture(false)
    f.values['session.get'] = { sessionId: 'bounded' }
    f.values['session.presentationSnapshot'] = await session.snapshot()
    expect(
      await run(
        ['agent', 'read', '--node', node.id, '--scrollback', '--lines', '5000', '-o', 'json'],
        f.io,
      ),
    ).toBe(0)
    expect(JSON.parse(f.out()).lines).toEqual(
      Array.from({ length: 5000 }, (_, i) => `Line ${i + 100}`),
    )
  } finally {
    session.dispose()
  }
})

it.each(['screen', 'scrollback'])(
  'reads erased wrapped rows from real serialization without fabricated characters: %s',
  async mode => {
    const session = new TerminalPresentationSession({ sessionId: 'erased-wrap', cols: 10, rows: 3 })
    try {
      await session.applyOutput(1, '1234567890abcdefghij')
      // Leave a wrapped successor, erase the preceding row's tail, then scroll it
      // into history. SerializeAddon must force a wrap and erase its temporary cells.
      await session.applyOutput(2, '\x1b[1;5H\x1b[K\x1b[3;1Hbottom\r\nnext')
      const snapshot = await session.snapshot()
      expect(snapshot.serializedScreen).toContain('\x1b[6X')
      const f = identityFixture(false)
      f.values['session.get'] = { sessionId: snapshot.sessionId }
      f.values['session.presentationSnapshot'] = snapshot
      expect(
        await run(
          ['agent', 'read', '--node', node.id, `--${mode}`, '--lines', '5000', '-o', 'json'],
          f.io,
        ),
      ).toBe(0)
      expect(JSON.parse(f.out()).lines).toEqual([
        ...(mode === 'scrollback' ? ['1234'] : []),
        'abcdefghij',
        'bottom',
        'next',
      ])
    } finally {
      session.dispose()
    }
  },
)
