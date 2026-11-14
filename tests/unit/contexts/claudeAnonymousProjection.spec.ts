import { expect, it } from 'vitest'
import { ClaudeJournalProof } from '../../../src/contexts/agent/application/ClaudeJournalProof'
import type { JournalFact } from '../../../src/contexts/agent/application/ClaudeJournalFact'

const fact = (kind: JournalFact['kind'], id: string, at: number): JournalFact => ({
  kind,
  id,
  at,
  received: at + 1,
  key: `${kind}:${id}:${at}`,
  order: at,
})
it.each([
  'old-state',
  'after-End',
  'tied-End',
  'late-callback',
  'captured',
  'input',
  'known-successor',
  'missing-End',
  'unknown-End',
])(
  'requires explicit predecessor interval proof before retiring an anonymous projection: %s',
  variant => {
    const anonymous = {
      ...fact('activity', '', variant === 'after-End' ? 25 : variant === 'tied-End' ? 20 : 15),
      io: true,
      input: false,
    }
    const start = { ...fact('start', 'A', 10), clear: false }
    const end = { ...fact('end', variant === 'unknown-End' ? 'U' : 'A', 20), clear: true }
    if (variant === 'late-callback') {
      anonymous.received = 40
    }
    if (variant === 'captured') {
      Object.assign(anonymous, {
        capture: { id: undefined, invocation: {}, serial: 1, retired: false },
      })
    }
    if (variant === 'input') {
      anonymous.input = true
    }
    if (variant === 'known-successor') {
      anonymous.id = 'B'
    }
    const proof = new ClaudeJournalProof([
      start,
      anonymous,
      ...(variant === 'missing-End' ? [] : [end]),
      { ...fact('start', 'B', 30), clear: true },
    ])
    expect(proof.retired(anonymous)).toBe(variant === 'old-state')
  },
)
it.each(['fresh', 'replayed', 'before-Start', 'input', 'captured', 'other-identity'])(
  'requires a fresh current completion to resolve current-invocation anonymous state: %s',
  variant => {
    const anonymous = {
      ...fact('activity', '', variant === 'before-Start' ? 15 : 30),
      io: true,
      input: false,
    }
    if (variant === 'input') {
      anonymous.input = true
    }
    if (variant === 'captured') {
      Object.assign(anonymous, {
        capture: { id: undefined, invocation: {}, serial: 1, retired: false },
      })
    }
    if (variant === 'other-identity') {
      anonymous.id = 'U'
    }
    const stop = { ...fact('complete', 'B', 40), order: variant === 'replayed' ? 10 : 40 }
    const proof = new ClaudeJournalProof([
      { ...fact('start', 'B', 20), clear: true },
      anonymous,
      stop,
    ])
    expect(proof.resolved(anonymous)).toBe(variant === 'fresh')
  },
)
