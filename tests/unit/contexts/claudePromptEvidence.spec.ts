import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { claudePromptDigest } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import { canonicalizePromptText } from '../../../src/contexts/agent/domain/promptText'

// Recorded real-PTY UserPromptSubmit prompts from Claude Code 2.1.319.
const probe = [
  ['three-lines', 'Line one\nLine two\nLine three', 'Line one\nLine two\nLine three'],
  ['five-lines', 'One\nTwo\nThree\nFour\nFive', 'One\nTwo\nThree\nFour\nFive'],
  ['long-900', 'x'.repeat(900), 'x'.repeat(900)],
  ['edge-whitespace', '  leading spaces and trailing tab\t  ', '  leading spaces and trailing tab'],
  ['interior-blank', 'Alpha\n\nBeta', 'Alpha\n\nBeta'],
  ['unicode', '中文测试 🎉 café', '中文测试 🎉 café'],
  [
    'literal-marker',
    '[Pasted text #1 +3 lines] is literal text',
    '[Pasted text #1 +3 lines] is literal text',
  ],
  ['crlf', 'Win line one\r\nWin line two', 'Win line one\nWin line two'],
]

describe('Claude comparison profile v1', () => {
  it.each(probe)('matches the recorded %s hook prompt', (_name, sent, observed) => {
    expect(claudePromptDigest(canonicalizePromptText(sent))).toBe(claudePromptDigest(observed))
  })
  it('pins UTF-8, domain separation, newline order and the trailing ASCII character set', () => {
    expect(claudePromptDigest('  中\r\nB\rC \t\r\n')).toBe(
      createHash('sha256')
        .update('opencove-prompt-evidence-claude-code-v1\0  中\nB\nC', 'utf8')
        .digest('hex'),
    )
  })
  it.each([
    ['  A', 'A'],
    ['A B', 'A  B'],
    ['A\tB', 'A B'],
    ['A\n\nB', 'A\nB'],
    ['A\u00a0', 'A'],
    ['A\ufeff', 'A'],
    ['é', 'e\u0301'],
    ['[Pasted text #1 +3 lines]', 'One\nTwo\nThree\nFour'],
  ])('keeps %j distinct from %j', (left, right) => {
    expect(claudePromptDigest(left)).not.toBe(claudePromptDigest(right))
  })
  it.each([
    undefined,
    null,
    1,
    {},
    ['prompt'],
    '\ud800',
    '\udc00',
    'x'.repeat(256 * 1024 + 1),
    '中'.repeat(90000),
  ])('drops malformed or oversized prompt evidence %#', value => {
    expect(claudePromptDigest(value)).toBeUndefined()
  })
  it('accepts empty and whitespace-only strings and prompts above the delivery budget without truncation', () => {
    expect(claudePromptDigest('')).toBe(claudePromptDigest(' \t\r\n'))
    expect(claudePromptDigest('x'.repeat(32769))).toMatch(/^[a-f0-9]{64}$/)
  })
})

it('normalizes a long whitespace run followed by text in linear time', () => {
  const started = performance.now()
  expect(claudePromptDigest(' '.repeat(250_000) + 'x')).toBeDefined()
  expect(claudePromptDigest('x' + ' \t\n'.repeat(80_000))).toBe(claudePromptDigest('x'))
  // The former suffix regex took tens of seconds on the first input.
  expect(performance.now() - started).toBeLessThan(1_000)
})
