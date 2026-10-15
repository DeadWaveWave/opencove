import { describe, expect, it } from 'vitest'
import { stripTerminalQuerySequences } from './automaticTerminalSequences'

describe('stripTerminalQuerySequences', () => {
  it.each([
    ['OSC 11 background query (BEL)', 'a\u001b]11;?\u0007b', 'ab'],
    ['OSC 10 foreground query (ST)', 'a\u001b]10;?\u001b\\b', 'ab'],
    ['OSC 4 palette query', 'a\u001b]4;1;?\u0007b', 'ab'],
    ['cursor position report request', 'a\u001b[6nb', 'ab'],
    ['device attributes', 'a\u001b[cb\u001b[>c', 'ab'],
    ['kitty keyboard query', 'a\u001b[?ub', 'ab'],
  ])('removes a replayed %s so a new terminal does not answer it again', (_, input, expected) => {
    expect(stripTerminalQuerySequences(input)).toBe(expected)
  })

  it('keeps output that sets colours, moves the cursor or styles text', () => {
    const output =
      '\u001b]11;rgb:0c0c/1212/1717\u0007\u001b[2J\u001b[1;1H\u001b[31mred\u001b[0m\u001b]0;title\u0007'
    expect(stripTerminalQuerySequences(output)).toBe(output)
  })
})
