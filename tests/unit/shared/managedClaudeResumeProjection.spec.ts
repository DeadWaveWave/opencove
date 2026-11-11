import { describe, expect, it } from 'vitest'
import {
  projectOwnedManagedClaudeNode,
  normalizeManagedClaudeResumeBindingOwnership,
} from '@shared/sync/managedClaudeResumeProjection'

describe('managed Claude ownership projection', () => {
  const canonical = {
    kind: 'agent',
    sessionId: 'runtime-B',
    workerBinding: null,
    managedClaudeResumeBindingOwnership: {
      activationId: 'activation-B',
      runtimeSessionId: 'runtime-B',
    },
    agent: {
      provider: 'claude-code',
      resumeSessionId: 'B',
      resumeSessionIdVerified: true,
      model: 'old',
    },
  }
  const local = {
    ...canonical,
    kind: 'terminal',
    sessionId: 'runtime-A',
    title: 'Local title',
    agent: { provider: 'pi', resumeSessionId: 'A', resumeSessionIdVerified: false, model: 'new' },
  }
  it('projects identity and both tuple fields atomically while preserving permitted edits', () => {
    expect(projectOwnedManagedClaudeNode(canonical, local)).toMatchObject({
      kind: 'agent',
      sessionId: 'runtime-B',
      title: 'Local title',
      agent: {
        provider: 'claude-code',
        resumeSessionId: 'B',
        resumeSessionIdVerified: true,
        model: 'new',
      },
      managedClaudeResumeBindingOwnership: canonical.managedClaudeResumeBindingOwnership,
    })
  })
  it('preserves an unowned proposal', () => {
    expect(
      projectOwnedManagedClaudeNode(
        { ...canonical, managedClaudeResumeBindingOwnership: undefined },
        local,
      ),
    ).toBe(local)
  })
  it('keeps a shell association when the settled ledger runtime is null', () => {
    expect(
      projectOwnedManagedClaudeNode(
        {
          ...canonical,
          managedClaudeResumeBindingOwnership: { activationId: 'settled', runtimeSessionId: null },
        },
        local,
      ).sessionId,
    ).toBe('runtime-A')
  })
  it.each([
    undefined,
    null,
    {},
    { activationId: '', runtimeSessionId: null },
    { activationId: 'a', runtimeSessionId: 1 },
  ])('rejects malformed markers %j', value => {
    expect(normalizeManagedClaudeResumeBindingOwnership(value)).toBeNull()
  })
})
