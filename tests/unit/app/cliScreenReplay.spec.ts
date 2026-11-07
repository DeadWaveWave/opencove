// @vitest-environment node
import { expect, it } from 'vitest'
import { replayScreen } from '../../../src/app/cli/core/screenReplay'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'

const replay = (
  serializedScreen: string,
  cols = 40,
  rows = 6,
  bufferKind: 'normal' | 'alternate' = 'normal',
) => replayScreen({ serializedScreen, cols, rows, bufferKind })
it.each([
  [
    'forward spacing',
    'Claude\x1b[1CCode\x1b[2Casks\x1b[3Cfor\x1b[5Cpermission',
    ['Claude Code  asks   for     permission'],
  ],
  [
    'cursor-up overwrite',
    'first\r\nwrong\r\nthird\x1b[2A\rFIRST\x1b[1B\rRIGHT',
    ['FIRST', 'RIGHT', 'third'],
  ],
  ['CUP, home, back', '\x1b[3;5HDialog\x1b[HHeader\x1b[36D!', ['!eader', '', '    Dialog']],
  ['CJK and emoji cells', '你🙂\x1b[2CX\x1b[2;5H好\x1b[CZ', ['你🙂  X', '    好 Z']],
  [
    'OSC hyperlinks',
    '\x1b]8;;https://example.test\x1b\\link\x1b]8;;\x1b\\\x1b[Ctext',
    ['link text'],
  ],
  [
    'SGR and private modes',
    '\x1b[31mred\x1b[0m\x1b[?2004h\x1b[?1003h\x1b[?1004h\x1b[2Ctext',
    ['red  text'],
  ],
] as const)('renders %s golden', (_name, input, expected) => {
  const lines = replay(input)
  expect(lines).toEqual(expected)
  expect(lines).toMatchSnapshot()
})
it('implements CR, LF, BS, TAB and trims row padding', () => {
  expect(replay('ab\bX\tZ\r\nline\n!')).toEqual(['aX      Z', 'line', '    !'])
})
it('defaults and clamps all supported cursor movements', () => {
  expect(
    replay('\x1b[999B\x1b[999Cz\x1b[0A\x1b[0DX\x1b[FY\x1b[E\x1b[GQ\x1b[1d\x1b[;fH', 5, 4),
  ).toEqual(['H', 'Y', 'Q  X', '    z'])
})
it.each([
  ['K', 'abcdef\x1b[3G\x1b[K', ['ab']],
  ['1K', 'abcdef\x1b[3G\x1b[1K', ['   def']],
  ['2K', 'abcdef\x1b[2K', []],
  ['J', 'one\r\ntwo\r\nthree\x1b[2;2H\x1b[J', ['one', 't']],
  ['1J', 'one\r\ntwo\r\nthree\x1b[2;2H\x1b[1J', ['', '  o', 'three']],
  ['2J', 'one\r\ntwo\x1b[2J', []],
] as const)('implements erase %s', (_name, input, expected) =>
  expect(replay(input)).toEqual(expected),
)
it('clears both halves when overwriting or erasing a wide cell', () => {
  expect(replay('你好\x1b[2Gx')).toEqual([' x好'])
  expect(replay('你好\x1b[2G\x1b[K')).toEqual([])
})
it('keeps combining/emoji graphemes in one cell group and wraps at the right margin', () => {
  expect(replay('e\u0301👩🏽‍💻\x1b[C!')).toEqual(['é👩🏽‍💻 !'])
  expect(replay('123你Z', 4, 3)).toEqual(['123', '你Z'])
  expect(replay('1234X', 4, 3)).toEqual(['1234', 'X'])
})
it('scrolls LF at the bottom but cursor positioning never scrolls', () => {
  expect(replay('one\r\ntwo\r\nthree', 10, 2)).toEqual(['two', 'three'])
  expect(replay('a\x1b[999Bb', 10, 2)).toEqual(['a', ' b'])
})
it('selects the snapshot buffer without leaking normal content into alternate content', () => {
  const both = 'NORMAL\x1b[?1049h\x1b[HALT\x1b[2Cscreen\x1b[?2004h'
  expect(replay(both, 40, 6, 'alternate')).toEqual(['ALT  screen'])
  expect(replay(both)).toEqual(['NORMAL'])
  expect(replay('ALT ONLY', 40, 6, 'alternate')).toEqual(['ALT ONLY'])
})
it('ignores unsupported strings, charset escapes, CSI intermediates and truncated sequences', () => {
  expect(
    replay('a\x1b(0b\x1bPpayload\x1b\\c\x1b_ignored\x1b\\d\x1b[1 qE\x1b]unterminated'),
  ).toEqual(['abcdE'])
})
it.each(['normal', 'alternate'] as const)(
  'replays a real presentation-session serialization of %s content',
  async bufferKind => {
    const session = new TerminalPresentationSession({ sessionId: 'fixture', cols: 40, rows: 6 })
    try {
      await session.applyOutput(1, 'NORMAL HISTORY')
      const screen =
        '\x1b[H\x1b[2JClaude\x1b[CCode\x1b[2;3HPermission\x1b[3Cneeded\x1b[3;3H你\x1b[2Cready\x1b[?2004h'
      await session.applyOutput(2, (bufferKind === 'alternate' ? '\x1b[?1049h' : '') + screen)
      const snapshot = await session.snapshot()
      expect(snapshot.bufferKind).toBe(bufferKind)
      expect(replayScreen(snapshot)).toEqual([
        'Claude Code',
        '  Permission   needed',
        '  你  ready',
      ])
      expect({
        serializedScreen: snapshot.serializedScreen,
        lines: replayScreen(snapshot),
      }).toMatchSnapshot()
    } finally {
      session.dispose()
    }
  },
)

it('handles C1 CSI/OSC/ST and ignores their hidden payloads', () => {
  expect(replay('a\x9b2Cb\x9d8;;secret\x9clink\x9d8;;\x9c')).toEqual(['a  blink'])
})
it('honors an explicit normal buffer after alternate content and a switch back', () => {
  expect(replay('NORMAL\x1b[?1049hALT\x1b[?1049l\rHOME')).toEqual(['HOMEAL'])
})
it.each([
  [0, 24],
  [80, 0],
  [1.5, 10],
  [100000, 100000],
])('rejects invalid or unbounded geometry %s/%s', (cols, rows) => {
  expect(() => replay('x', cols, rows)).toThrow('Invalid terminal snapshot geometry')
})
