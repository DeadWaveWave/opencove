import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { locateAgentResumeSessionId } from '../../../src/main/infrastructure/agent/AgentSessionLocator'

describe('locateAgentResumeSessionId (codex)', () => {
  it('picks latest rollout session id for matching cwd', async () => {
    const tempHome = await fs.mkdtemp(join(tmpdir(), 'cove-test-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = tempHome

    const cwd = join(tempHome, 'workspace')
    const startedAtMs = Date.now()

    const date = new Date(startedAtMs)
    const year = String(date.getFullYear())
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    const sessionsDir = join(tempHome, '.codex', 'sessions', year, month, day)
    const olderFile = join(sessionsDir, 'rollout-older.jsonl')
    const newerFile = join(sessionsDir, 'rollout-newer.jsonl')

    try {
      await fs.mkdir(sessionsDir, { recursive: true })

      await fs.writeFile(
        olderFile,
        `${JSON.stringify({ payload: { id: 'session-older', cwd } })}\n${'x'.repeat(100_000)}\n`,
        'utf8',
      )

      await fs.writeFile(
        newerFile,
        `${JSON.stringify({ payload: { id: 'session-newer', cwd } })}\n${'x'.repeat(100_000)}\n`,
        'utf8',
      )

      const olderTime = new Date(startedAtMs - 10_000)
      const newerTime = new Date(startedAtMs - 1000)
      await fs.utimes(olderFile, olderTime, olderTime)
      await fs.utimes(newerFile, newerTime, newerTime)

      const sessionId = await locateAgentResumeSessionId({
        provider: 'codex',
        cwd,
        startedAtMs,
        timeoutMs: 0,
      })

      expect(sessionId).toBe('session-newer')
    } finally {
      process.env.HOME = previousHome
    }
  })
})
