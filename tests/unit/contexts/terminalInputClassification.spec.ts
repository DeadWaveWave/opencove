import { describe, expect, it } from 'vitest'
import {
  extractAutomaticTerminalQuerySequences,
  isAutomaticTerminalQuery,
  isAutomaticTerminalReply,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/inputClassification'
import { stripAutomaticTerminalQueriesFromOutput } from '../../../src/shared/terminal/automaticTerminalSequences'

describe('isAutomaticTerminalReply', () => {
  it('returns true for a single DSR reply', () => {
    expect(isAutomaticTerminalReply('\u001b[1;1R')).toBe(true)
  })

  it('returns true for concatenated automatic replies in one chunk', () => {
    expect(isAutomaticTerminalReply('\u001b[1;1R\u001b[2;1R\u001b[?62;4c')).toBe(true)
  })

  it('returns true for xterm DECRPSS private mode replies used by OpenCode startup', () => {
    expect(isAutomaticTerminalReply('\u001b[?1016;2$y')).toBe(true)
    expect(isAutomaticTerminalReply('\u001b[?2027;0$y\u001b[?2031;0$y')).toBe(true)
  })

  it('returns true for terminal OSC color query replies emitted during restored startup', () => {
    expect(isAutomaticTerminalReply('\u001b]10;rgb:d6d6/e4e4/ffff\u001b\\')).toBe(true)
    expect(isAutomaticTerminalReply('\u001b]11;rgb:0000/0000/0000\u0007')).toBe(true)
    expect(isAutomaticTerminalReply('\u001b[1;1R\u001b]10;rgb:d6d6/e4e4/ffff\u001b\\')).toBe(true)
  })

  it('returns false when visible text is mixed into the chunk', () => {
    expect(isAutomaticTerminalReply('\u001b[1;1Rhello')).toBe(false)
    expect(isAutomaticTerminalReply('\u001b]10;rgb:d6d6/e4e4/ffff\u001b\\hello')).toBe(false)
  })

  it('returns false for an incomplete CSI reply', () => {
    expect(isAutomaticTerminalReply('\u001b[1;1')).toBe(false)
  })
})

describe('isAutomaticTerminalQuery', () => {
  it('returns true for a single DSR query', () => {
    expect(isAutomaticTerminalQuery('\u001b[6n')).toBe(true)
  })

  it('returns true for concatenated automatic queries in one chunk', () => {
    expect(isAutomaticTerminalQuery('\u001b[6n\u001b[c\u001b[>c')).toBe(true)
  })

  it('returns false when visible text is mixed into the chunk', () => {
    expect(isAutomaticTerminalQuery('\u001b[6nready')).toBe(false)
  })
})

describe('stripAutomaticTerminalQueriesFromOutput', () => {
  it('removes automatic terminal queries and returns matching replies', () => {
    expect(stripAutomaticTerminalQueriesFromOutput('before\u001b[6n\u001b[cafter')).toStrictEqual({
      visibleData: 'beforeafter',
      replies: ['\u001b[1;1R', '\u001b[?1;2c'],
    })
  })

  it('leaves non-query escape sequences untouched', () => {
    expect(stripAutomaticTerminalQueriesFromOutput('\u001b[31mCOLOR\u001b[0m')).toStrictEqual({
      visibleData: '\u001b[31mCOLOR\u001b[0m',
      replies: [],
    })
  })
})

describe('extractAutomaticTerminalQuerySequences', () => {
  it('extracts recognized automatic queries from mixed output', () => {
    expect(extractAutomaticTerminalQuerySequences('before\u001b[6n\u001b[cafter')).toStrictEqual([
      '\u001b[6n',
      '\u001b[c',
    ])
  })
})
