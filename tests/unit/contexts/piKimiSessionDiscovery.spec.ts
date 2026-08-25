import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { locateAgentResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator'
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'

const originalHome = process.env.HOME
const originalKimiHome = process.env.KIMI_CODE_HOME
const originalPiSessions = process.env.PI_CODING_AGENT_SESSION_DIR

afterEach(() => {
  process.env.HOME = originalHome
  process.env.KIMI_CODE_HOME = originalKimiHome
  process.env.PI_CODING_AGENT_SESSION_DIR = originalPiSessions
})

describe('Pi and Kimi session discovery', () => {
  it('locates Pi v3 JSONL sessions by durable cwd/id metadata', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'opencove-pi-sessions-'))
    const cwd = join(root, 'workspace')
    const startedAtMs = Date.now()
    const filePath = join(root, 'project', 'turn_session-id.jsonl')
    process.env.PI_CODING_AGENT_SESSION_DIR = root
    await fs.mkdir(dirname(filePath), { recursive: true })
    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-session-id',
        timestamp: new Date(startedAtMs + 10).toISOString(),
        cwd,
      })}\n`,
    )

    await expect(
      locateAgentResumeSessionId({ provider: 'pi', cwd, startedAtMs, timeoutMs: 0 }),
    ).resolves.toBe('pi-session-id')
    await expect(
      resolveSessionFilePath({
        provider: 'pi',
        cwd,
        sessionId: 'pi-session-id',
        startedAtMs,
        timeoutMs: 0,
      }),
    ).resolves.toBe(filePath)
  })

  it('resolves Kimi session_index entries only inside the configured sessions root', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'opencove-kimi-home-'))
    const cwd = join(root, 'workspace')
    const sessionId = 'session_123'
    const sessionDir = join(root, 'sessions', 'wd_workspace_hash', sessionId)
    const wirePath = join(sessionDir, 'agents', 'main', 'wire.jsonl')
    const startedAtMs = Date.now()
    process.env.KIMI_CODE_HOME = root
    await fs.mkdir(dirname(wirePath), { recursive: true })
    await fs.writeFile(wirePath, '{"type":"metadata","protocol_version":"1.5"}\n')
    await fs.writeFile(
      join(root, 'session_index.jsonl'),
      `${JSON.stringify({ sessionId, sessionDir, workDir: cwd })}\n`,
    )

    await expect(
      locateAgentResumeSessionId({ provider: 'kimi', cwd, startedAtMs, timeoutMs: 0 }),
    ).resolves.toBe(sessionId)
    await expect(
      resolveSessionFilePath({
        provider: 'kimi',
        cwd,
        sessionId,
        startedAtMs,
        timeoutMs: 0,
      }),
    ).resolves.toBe(await fs.realpath(wirePath))
  })

  it('rejects a Kimi index entry that points outside its sessions root', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'opencove-kimi-home-'))
    const outside = await fs.mkdtemp(join(tmpdir(), 'opencove-kimi-outside-'))
    const cwd = join(root, 'workspace')
    const sessionId = 'session_escape'
    process.env.KIMI_CODE_HOME = root
    await fs.writeFile(
      join(root, 'session_index.jsonl'),
      `${JSON.stringify({ sessionId, sessionDir: outside, workDir: cwd })}\n`,
    )

    await expect(
      resolveSessionFilePath({
        provider: 'kimi',
        cwd,
        sessionId,
        startedAtMs: Date.now(),
        timeoutMs: 0,
      }),
    ).resolves.toBeNull()
  })
})
