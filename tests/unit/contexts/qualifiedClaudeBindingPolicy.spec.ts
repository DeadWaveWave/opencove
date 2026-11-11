import { expect, it } from 'vitest'
import {
  resolveQualifiedClaudeClearResumeBindingUpdate,
  resolveObservedResumeSessionBindingUpdate,
} from '../../../src/contexts/agent/domain/agentResumeBinding'
it('permits only qualified Claude successors and preserves ordinary verified-binding guards', () => {
  const binding = {
    provider: 'claude-code' as const,
    resumeSessionId: 'A',
    resumeSessionIdVerified: true,
  }
  expect(resolveQualifiedClaudeClearResumeBindingUpdate(binding, { resumeSessionId: 'B' })).toEqual(
    { resumeSessionId: 'B', resumeSessionIdVerified: true },
  )
  expect(resolveObservedResumeSessionBindingUpdate(binding, 'B')).toBeNull()
  expect(
    resolveQualifiedClaudeClearResumeBindingUpdate(binding, { resumeSessionId: 'A' }),
  ).toBeNull()
  expect(
    resolveQualifiedClaudeClearResumeBindingUpdate(binding, { resumeSessionId: ' ' }),
  ).toBeNull()
  expect(
    resolveQualifiedClaudeClearResumeBindingUpdate(
      { ...binding, provider: 'codex' },
      { resumeSessionId: 'B' },
    ),
  ).toBeNull()
})
