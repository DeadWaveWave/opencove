import { describe, expect, it } from 'vitest'
import {
  isResumeSessionBindingVerified,
  resolveLaunchedAgentResumeBinding,
  resolveObservedResumeSessionBindingUpdate,
} from '../../../src/contexts/agent/domain/agentResumeBinding'
import { normalizePersistedAgent } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveShared'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'

const sessionA = '11111111-1111-4111-8111-111111111111'
const sessionB = '22222222-2222-4222-8222-222222222222'

describe('Claude resume binding verification', () => {
  it.each([undefined, false])('does not trust a legacy or unverified ID (%s)', verified => {
    const binding = {
      provider: 'claude-code' as const,
      resumeSessionId: sessionA,
      resumeSessionIdVerified: verified,
    }

    expect(isResumeSessionBindingVerified(binding)).toBe(false)
    expect(resolveObservedResumeSessionBindingUpdate(binding, sessionB)).toEqual({
      resumeSessionId: sessionB,
      resumeSessionIdVerified: true,
    })
  })

  it.each([null, '', '   '])('does not verify an empty ID (%s)', resumeSessionId => {
    expect(
      isResumeSessionBindingVerified({
        provider: 'claude-code',
        resumeSessionId,
        resumeSessionIdVerified: true,
      }),
    ).toBe(false)
  })

  it.each([undefined, false, true])(
    'keeps renderer persistence and Worker verification consistent (%s)',
    resumeSessionIdVerified => {
      const rawAgent = {
        provider: 'claude-code',
        executionDirectory: '/test/workspace',
        prompt: 'Synthetic persistence fixture',
        resumeSessionId: sessionA,
        resumeSessionIdVerified,
      }
      const restored = ensurePersistedWorkspace(
        JSON.parse(
          JSON.stringify({
            id: 'workspace',
            name: 'Workspace',
            path: '/test/workspace',
            nodes: [
              {
                id: 'agent',
                kind: 'agent',
                title: 'Claude',
                width: 500,
                height: 300,
                position: { x: 0, y: 0 },
                agent: rawAgent,
              },
            ],
          }),
        ),
      )
      const rendererAgent = restored?.nodes[0]?.agent
      const workerAgent = normalizePersistedAgent(rawAgent)
      expect(rendererAgent?.resumeSessionIdVerified).toBe(resumeSessionIdVerified === true)
      expect(workerAgent?.resumeSessionIdVerified).toBe(resumeSessionIdVerified === true)
      expect(rendererAgent?.resumeSessionId).toBe(
        resumeSessionIdVerified === true ? sessionA : null,
      )
      expect(normalizePersistedAgent(rendererAgent)?.resumeSessionIdVerified).toBe(
        resumeSessionIdVerified === true,
      )
    },
  )

  it('preserves an explicitly verified durable ID against conflicting observations', () => {
    const binding = {
      provider: 'claude-code' as const,
      resumeSessionId: sessionA,
      resumeSessionIdVerified: true,
    }
    expect(isResumeSessionBindingVerified(binding)).toBe(true)
    expect(resolveObservedResumeSessionBindingUpdate(binding, sessionB)).toBeNull()
    expect(resolveObservedResumeSessionBindingUpdate(binding, null)).toBeNull()
  })

  it('records an assigned new Claude identity without promoting other provider guesses', () => {
    expect(resolveLaunchedAgentResumeBinding('claude-code', 'new', sessionA)).toEqual({
      resumeSessionId: sessionA,
      resumeSessionIdVerified: true,
    })
    expect(resolveLaunchedAgentResumeBinding('claude-code', 'new', null)).toEqual({
      resumeSessionId: null,
      resumeSessionIdVerified: false,
    })
    for (const provider of ['codex', 'opencode', 'pi', 'kimi', 'gemini'] as const) {
      expect(resolveLaunchedAgentResumeBinding(provider, 'new', sessionA)).toEqual({
        resumeSessionId: null,
        resumeSessionIdVerified: false,
      })
      expect(resolveLaunchedAgentResumeBinding(provider, 'resume', sessionA)).toEqual({
        resumeSessionId: sessionA,
        resumeSessionIdVerified: true,
      })
    }
  })
})
