import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn<typeof import('node:child_process').execFile>(),
}))

vi.mock('node:child_process', () => {
  return {
    execFile: execFileMock,
    default: {
      execFile: execFileMock,
    },
  }
})

import { locateAgentResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator'

describe('locateAgentResumeSessionId (opencode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches the uniquely recent OpenCode session for the cwd', async () => {
    const cwd = '/tmp/workspace'
    const startedAtMs = 1_773_561_870_000

    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      cb?.(
        null,
        JSON.stringify([
          {
            id: 'ses_recent',
            directory: cwd,
            created: startedAtMs + 150,
          },
          {
            id: 'ses_other',
            directory: '/tmp/other',
            created: startedAtMs + 200,
          },
        ]),
        '',
      )
      return {} as ReturnType<typeof execFileMock>
    })

    await expect(
      locateAgentResumeSessionId({
        provider: 'opencode',
        cwd,
        startedAtMs,
        timeoutMs: 0,
      }),
    ).resolves.toBe('ses_recent')
  })
})
