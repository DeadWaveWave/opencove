import { describe, expect, it } from 'vitest'
import { canonicalizePromptText } from '../../../src/contexts/agent/domain/promptText'
describe('prompt text', () => {
  it('canonicalizes semantic newlines and strips only trailing newlines', () => {
    expect(canonicalizePromptText(' 一\t\r\n二\r三\n\n')).toBe(' 一\t\r二\r三')
  })
  it.each([
    '',
    ' \r\n\t',
    '\ud800',
    '\udc00',
    'a\x1b[201~',
    'a\x00',
    'a\x7f',
    'a\x80',
    'a\x9f',
    'a\x0b',
    'a'.repeat(32769),
    '😀'.repeat(8193),
  ])('rejects invalid input %#', text => {
    expect(() => canonicalizePromptText(text)).toThrow()
  })
  it('measures UTF-8 bytes before canonicalization', () => {
    expect(canonicalizePromptText('😀'.repeat(8192))).toHaveLength(16384)
    expect(() => canonicalizePromptText('a' + '\n'.repeat(32768))).toThrow()
  })
})
