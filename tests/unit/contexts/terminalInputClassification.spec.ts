import { describe, expect, it } from 'vitest'
import {
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

  it('returns false when visible text is mixed into the chunk', () => {
    expect(isAutomaticTerminalReply('\u001b[1;1Rhello')).toBe(false)
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
