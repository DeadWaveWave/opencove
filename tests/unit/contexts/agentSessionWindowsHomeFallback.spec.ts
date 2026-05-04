import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { resolveHomeDirectoryCandidatesMock } = vi.hoisted(() => ({
  resolveHomeDirectoryCandidatesMock: vi.fn<() => string[]>(),
}))

vi.mock('../../../src/platform/os/HomeDirectory', () => ({
  resolveHomeDirectoryCandidates: resolveHomeDirectoryCandidatesMock,
}))

import { locateAgentResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator'
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'

function toDateParts(timestampMs: number): { year: string; month: string; day: string } {
  const date = new Date(timestampMs)
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  }
}

describe('agent session discovery with Windows home overrides', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('finds codex resume metadata from the actual profile home when HOME is overridden', async () => {
    const overriddenHome = await fs.mkdtemp(join(tmpdir(), 'opencove-overridden-home-'))
    const actualHome = await fs.mkdtemp(join(tmpdir(), 'opencove-actual-home-'))
    const cwd = join(actualHome, 'workspace')
    const startedAtMs = Date.now()
    const sessionId = 'codex-session-real-home'
    const { year, month, day } = toDateParts(startedAtMs)
    const sessionsDir = join(actualHome, '.codex', 'sessions', year, month, day)
    const sessionFilePath = join(sessionsDir, 'rollout-real-home.jsonl')

    resolveHomeDirectoryCandidatesMock.mockReturnValue([overriddenHome, actualHome])

    try {
      await fs.mkdir(sessionsDir, { recursive: true })
      await fs.writeFile(
        sessionFilePath,
        `${JSON.stringify({
          timestamp: new Date(startedAtMs + 200).toISOString(),
          type: 'session_meta',
          payload: {
            id: sessionId,
            cwd,
            timestamp: new Date(startedAtMs + 150).toISOString(),
          },
        })}\n`,
        'utf8',
      )

      const resolvedSessionId = await locateAgentResumeSessionId({
        provider: 'codex',
        cwd,
        startedAtMs,
        timeoutMs: 0,
      })

      expect(resolvedSessionId).toBe(sessionId)

      const resolvedSessionFilePath = await resolveSessionFilePath({
        provider: 'codex',
        cwd,
        sessionId,
        startedAtMs,
        timeoutMs: 0,
      })

      expect(resolvedSessionFilePath).toBe(sessionFilePath)
    } finally {
      await fs.rm(overriddenHome, { recursive: true, force: true })
      await fs.rm(actualHome, { recursive: true, force: true })
    }
  })
})
