import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { locateAgentResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator'

function toDateParts(timestampMs: number): { year: string; month: string; day: string } {
  const date = new Date(timestampMs)
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  }
}

function createRolloutFirstLine({
  sessionId,
  cwd,
  timestamp,
}: {
  sessionId: string
  cwd: string
  timestamp: string
}): string {
  return JSON.stringify({
    timestamp,
    type: 'session_meta',
    payload: {
      id: sessionId,
      cwd,
      timestamp,
    },
  })
}

describe('locateAgentResumeSessionId (codex)', () => {
  it('returns the uniquely matching session_meta candidate near launch time', async () => {
    const tempHome = await fs.mkdtemp(join(tmpdir(), 'cove-test-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = tempHome

    const cwd = join(tempHome, 'workspace')
    const startedAtMs = Date.now()
    const { year, month, day } = toDateParts(startedAtMs)
    const sessionsDir = join(tempHome, '.codex', 'sessions', year, month, day)

    try {
      await fs.mkdir(sessionsDir, { recursive: true })
      await fs.writeFile(
        join(sessionsDir, 'rollout-a.jsonl'),
        `${createRolloutFirstLine({
          sessionId: 'session-expected',
          cwd,
          timestamp: new Date(startedAtMs + 150).toISOString(),
        })}
`,
        'utf8',
      )
      await fs.writeFile(
        join(sessionsDir, 'rollout-b.jsonl'),
        `${createRolloutFirstLine({
          sessionId: 'session-other-cwd',
          cwd: join(tempHome, 'different-workspace'),
          timestamp: new Date(startedAtMs + 200).toISOString(),
        })}
`,
        'utf8',
      )

      const sessionId = await locateAgentResumeSessionId({
        provider: 'codex',
        cwd,
        startedAtMs,
        timeoutMs: 0,
      })

      expect(sessionId).toBe('session-expected')
    } finally {
      process.env.HOME = previousHome
      await fs.rm(tempHome, { recursive: true, force: true })
    }
  })

  it('returns null when multiple same-cwd rollout candidates are plausible', async () => {
    const tempHome = await fs.mkdtemp(join(tmpdir(), 'cove-test-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = tempHome

    const cwd = join(tempHome, 'workspace')
    const startedAtMs = Date.now()
    const { year, month, day } = toDateParts(startedAtMs)
    const sessionsDir = join(tempHome, '.codex', 'sessions', year, month, day)

    try {
      await fs.mkdir(sessionsDir, { recursive: true })
      await fs.writeFile(
        join(sessionsDir, 'rollout-a.jsonl'),
        `${createRolloutFirstLine({
          sessionId: 'session-a',
          cwd,
          timestamp: new Date(startedAtMs + 120).toISOString(),
        })}
`,
        'utf8',
      )
      await fs.writeFile(
        join(sessionsDir, 'rollout-b.jsonl'),
        `${createRolloutFirstLine({
          sessionId: 'session-b',
          cwd,
          timestamp: new Date(startedAtMs + 220).toISOString(),
        })}
`,
        'utf8',
      )

      const sessionId = await locateAgentResumeSessionId({
        provider: 'codex',
        cwd,
        startedAtMs,
        timeoutMs: 0,
      })

      expect(sessionId).toBeNull()
    } finally {
      process.env.HOME = previousHome
      await fs.rm(tempHome, { recursive: true, force: true })
    }
  })
})
