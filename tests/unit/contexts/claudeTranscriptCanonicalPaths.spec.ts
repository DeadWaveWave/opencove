import { expect, it } from 'vitest'
import { canonicalTranscriptPath } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'

it.each([
  ['\\\\?\\C:\\config\\projects\\p\\s.jsonl', 'C:\\config\\projects\\p\\s.jsonl'],
  ['\\\\?\\UNC\\host\\share\\projects\\p\\s.jsonl', '\\\\host\\share\\projects\\p\\s.jsonl'],
  ['C:\\config\\projects\\p\\s.jsonl', 'C:\\config\\projects\\p\\s.jsonl'],
])('Windows canonical transcript aliases preserve equivalent containment: %s', (path, expected) => {
  expect(canonicalTranscriptPath(path, 'win32')).toBe(expected)
})
