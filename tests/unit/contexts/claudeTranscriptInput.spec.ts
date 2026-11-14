import { expect, it } from 'vitest'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { getClaudeTranscriptInput } from '../../../src/shared/runtime/agentHook/claudeTranscript'
import { transcriptLine } from '../../support/claudeNonClear/transcript'

it.each(['metadata', 'local-command', 'command-markup'] as const)(
  'preserves ordinary invalid-user parsing and requires metadata for %s',
  variant => {
    const parsed = parseClaudeTranscript(transcriptLine(variant, 'B'))!
    expect(parsed).toStrictEqual({ kind: 'invalid_user' })
    expect(getClaudeTranscriptInput(parsed)).toBe(variant === 'metadata' ? 'auxiliary' : undefined)
    expect(JSON.stringify(parsed)).not.toContain('auxiliary')
  },
)
it('preserves identified metadata as a normal queued user record', () => {
  const parsed = parseClaudeTranscript(transcriptLine('identified-metadata', 'B', 'p'))!
  expect(parsed).toStrictEqual({ kind: 'user', promptId: 'p', promptSource: 'queued', uuid: 'r1' })
  expect(getClaudeTranscriptInput(parsed)).toBe('auxiliary')
})
