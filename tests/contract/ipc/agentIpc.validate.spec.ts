import { describe, expect, it } from 'vitest'
import { getAppErrorDebugMessage, OpenCoveAppError } from '../../../src/shared/errors/appError'

describe('agent IPC validation', () => {
  it('accepts Windows absolute cwd values on non-Windows runners', async () => {
    const {
      normalizeLaunchAgentPayload,
      normalizeReadLastMessagePayload,
      normalizeResolveResumeSessionPayload,
    } = await import('../../../src/contexts/agent/presentation/main-ipc/validate')

    expect(
      normalizeLaunchAgentPayload({
        provider: 'codex',
        cwd: 'C:\\Users\\deadwave\\project',
        prompt: 'hello',
      }),
    ).toEqual(
      expect.objectContaining({
        provider: 'codex',
        cwd: 'C:\\Users\\deadwave\\project',
        prompt: 'hello',
      }),
    )

    expect(
      normalizeResolveResumeSessionPayload({
        provider: 'codex',
        cwd: 'C:\\Users\\deadwave\\project',
        startedAt: '2026-03-28T15:59:05.000Z',
      }),
    ).toEqual({
      provider: 'codex',
      cwd: 'C:\\Users\\deadwave\\project',
      startedAt: '2026-03-28T15:59:05.000Z',
    })

    expect(
      normalizeReadLastMessagePayload({
        provider: 'codex',
        cwd: 'C:\\Users\\deadwave\\project',
        startedAt: '2026-03-28T15:59:05.000Z',
      }),
    ).toEqual({
      provider: 'codex',
      cwd: 'C:\\Users\\deadwave\\project',
      startedAt: '2026-03-28T15:59:05.000Z',
      resumeSessionId: null,
    })
  })

  it('still rejects relative cwd values for agent launch', async () => {
    const { normalizeLaunchAgentPayload } =
      await import('../../../src/contexts/agent/presentation/main-ipc/validate')

    try {
      normalizeLaunchAgentPayload({
        provider: 'codex',
        cwd: 'relative\\path',
        prompt: 'hello',
      })
      throw new Error('Expected normalizeLaunchAgentPayload to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(OpenCoveAppError)
      expect((error as OpenCoveAppError).code).toBe('common.invalid_input')
      expect(getAppErrorDebugMessage(error)).toBe('agent:launch requires an absolute cwd')
    }
  })
})
