import { expect, it } from 'vitest'
import capture from '../../fixtures/claude/clear-transcripts-2.1.322.json'
import { ClaudeTranscriptCheckpoint } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptCheckpoint'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { getClaudeTranscriptInput } from '../../../src/shared/runtime/agentHook/claudeTranscript'

it.each([
  'valid',
  'human',
  'missing-command',
  'wrong-command',
  'arguments',
  'wrong-parent',
  'wrong-session',
  'missing-meta',
  'reversed',
])('requires the provider-owned caveat → echo → commandRun chain: %s', variant => {
  const lines = capture.transcripts.B.slice(2).map(line => JSON.parse(line))
  if (variant === 'human') {
    lines[1].origin = { kind: 'human' }
  }
  if (variant === 'missing-command') {
    delete lines[2].commandRun
  }
  if (variant === 'wrong-command') {
    lines[2].commandRun.command = 'help'
  }
  if (variant === 'arguments') {
    lines[2].commandRun.args = 'work'
  }
  if (variant === 'wrong-parent') {
    lines[2].parentUuid = lines[0].uuid
  }
  if (variant === 'wrong-session') {
    lines[2].sessionId = 'C'
  }
  if (variant === 'missing-meta') {
    delete lines[0].isMeta
  }
  if (variant === 'reversed') {
    ;[lines[1], lines[2]] = [lines[2], lines[1]]
  }
  const checkpoint = new ClaudeTranscriptCheckpoint()
  let echo: ReturnType<typeof parseClaudeTranscript>
  for (const raw of lines) {
    const line = JSON.stringify(raw),
      record = parseClaudeTranscript(line)
    if (raw.type === 'user' && raw.isMeta !== true) {
      echo = record
      expect(getClaudeTranscriptInput(echo!)).toBeUndefined()
    }
    checkpoint.observe(record, line)
  }
  expect(getClaudeTranscriptInput(echo!)).toBe(variant === 'valid' ? 'auxiliary' : undefined)
})
