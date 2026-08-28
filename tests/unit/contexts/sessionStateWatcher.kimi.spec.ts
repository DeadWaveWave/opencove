import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionStateWatcherController } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import type {
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../src/shared/contracts/dto'

const originalKimiHome = process.env.KIMI_CODE_HOME
const originalPiSessions = process.env.PI_CODING_AGENT_SESSION_DIR
const line = (value: unknown) => `${JSON.stringify(value)}\n`

afterEach(() => {
  if (originalKimiHome === undefined) {
    delete process.env.KIMI_CODE_HOME
  } else {
    process.env.KIMI_CODE_HOME = originalKimiHome
  }
  if (originalPiSessions === undefined) {
    delete process.env.PI_CODING_AGENT_SESSION_DIR
  } else {
    process.env.PI_CODING_AGENT_SESSION_DIR = originalPiSessions
  }
})

async function createKimiWire(protocolVersion: string, records: unknown[]) {
  const root = await fs.mkdtemp(join(tmpdir(), 'opencove-kimi-controller-'))
  const cwd = join(root, 'workspace')
  const sessionId = 'session_kimi'
  const sessionDir = join(root, 'sessions', 'wd_workspace_hash', sessionId)
  const wirePath = join(sessionDir, 'agents', 'main', 'wire.jsonl')
  process.env.KIMI_CODE_HOME = root
  await fs.mkdir(dirname(wirePath), { recursive: true })
  await fs.writeFile(
    wirePath,
    [line({ type: 'metadata', protocol_version: protocolVersion }), ...records.map(line)].join(''),
  )
  await fs.writeFile(
    join(root, 'session_index.jsonl'),
    line({ sessionId, sessionDir, workDir: cwd }),
  )
  const startedAtMs = (await fs.stat(wirePath)).birthtimeMs
  return { cwd, sessionId, startedAtMs, wirePath }
}

function createHarness() {
  const states: TerminalSessionStateEvent[] = []
  const metadata: TerminalSessionMetadataEvent[] = []
  const issues: string[] = []
  const controller = createSessionStateWatcherController({
    sendToAllWindows: () => undefined,
    reportIssue: issue => issues.push(issue),
    onState: event => states.push(event),
    onMetadata: event => metadata.push(event),
  })
  return { controller, states, metadata, issues }
}

describe('session state watcher Kimi pipeline', () => {
  it('imports Kimi wire observations into terminal working/standby state', async () => {
    const session = await createKimiWire('1.5', [{ type: 'turn.prompt' }])
    const harness = createHarness()
    harness.controller.start({
      sessionId: 'terminal-kimi',
      provider: 'kimi',
      cwd: session.cwd,
      launchMode: 'new',
      resumeSessionId: null,
      startedAtMs: session.startedAtMs,
    })

    await vi.waitFor(() =>
      expect(harness.states).toContainEqual({
        sessionId: 'terminal-kimi',
        state: 'working',
        source: 'session_file',
      }),
    )
    expect(harness.metadata).toContainEqual({
      sessionId: 'terminal-kimi',
      resumeSessionId: session.sessionId,
    })

    await fs.appendFile(
      session.wirePath,
      line({
        type: 'context.append_loop_event',
        event: { type: 'step.end', finishReason: 'end_turn' },
      }),
    )
    await vi.waitFor(() =>
      expect(harness.states.at(-1)).toEqual({
        sessionId: 'terminal-kimi',
        state: 'standby',
        source: 'session_file',
      }),
    )
    harness.controller.dispose()
  })

  it('projects unsupported protocol as degraded launch fallback, not observed standby', async () => {
    const session = await createKimiWire('2.0', [{ type: 'turn.prompt' }])
    const harness = createHarness()
    harness.controller.start({
      sessionId: 'terminal-kimi-unsupported',
      provider: 'kimi',
      cwd: session.cwd,
      launchMode: 'new',
      resumeSessionId: null,
      startedAtMs: session.startedAtMs,
    })

    await vi.waitFor(() =>
      expect(harness.states).toContainEqual({
        sessionId: 'terminal-kimi-unsupported',
        state: 'standby',
        source: 'launch',
        degraded: true,
      }),
    )
    expect(harness.states.some(event => event.source === 'session_file')).toBe(false)
    harness.controller.dispose()
  })

  it('waits silently for first Kimi evidence, then degrades explicit wire unavailability', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'opencove-kimi-controller-unavailable-'))
    const cwd = join(root, 'workspace')
    const sessionId = 'session_kimi_unavailable'
    const sessionDir = join(root, 'sessions', 'wd_workspace_hash', sessionId)
    const wirePath = join(sessionDir, 'agents', 'main', 'wire.jsonl')
    process.env.KIMI_CODE_HOME = root
    const harness = createHarness()
    const startedAtMs = Date.now()
    harness.controller.start({
      sessionId: 'terminal-kimi-unavailable',
      provider: 'kimi',
      cwd,
      launchMode: 'new',
      resumeSessionId: null,
      startedAtMs,
    })

    expect(harness.states).toEqual([])

    await fs.mkdir(dirname(wirePath), { recursive: true })
    await fs.writeFile(wirePath, line({ type: 'metadata', protocol_version: '2.0' }))
    await fs.writeFile(
      join(root, 'session_index.jsonl'),
      line({ sessionId, sessionDir, workDir: cwd }),
    )

    await vi.waitFor(() => expect(harness.states).toHaveLength(1))
    expect(harness.states).toEqual([
      {
        sessionId: 'terminal-kimi-unavailable',
        state: 'standby',
        source: 'launch',
        degraded: true,
      },
    ])
    expect(harness.states.some(event => event.source === 'session_file')).toBe(false)
    expect(harness.states.some(event => event.state === 'working')).toBe(false)
    harness.controller.dispose()
  })

  it('imports Pi session observations into terminal working/standby state', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'opencove-pi-controller-'))
    const cwd = join(root, 'workspace')
    const filePath = join(root, 'project', 'session.jsonl')
    const startedAtMs = Date.now()
    process.env.PI_CODING_AGENT_SESSION_DIR = root
    await fs.mkdir(dirname(filePath), { recursive: true })
    await fs.writeFile(
      filePath,
      line({
        type: 'session',
        version: 3,
        id: 'pi-session',
        timestamp: new Date(startedAtMs).toISOString(),
        cwd,
      }) + line({ type: 'message', message: { role: 'user' } }),
    )
    const harness = createHarness()
    harness.controller.start({
      sessionId: 'terminal-pi',
      provider: 'pi',
      cwd,
      launchMode: 'new',
      resumeSessionId: null,
      startedAtMs,
    })

    await vi.waitFor(() =>
      expect(harness.metadata).toContainEqual({
        sessionId: 'terminal-pi',
        resumeSessionId: 'pi-session',
      }),
    )
    await vi.waitFor(() =>
      expect(harness.states).toContainEqual({
        sessionId: 'terminal-pi',
        state: 'working',
        source: 'session_file',
      }),
    )

    await fs.appendFile(
      filePath,
      line({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '<redacted>' }],
          stopReason: 'stop',
        },
      }),
    )
    await vi.waitFor(() =>
      expect(harness.states.at(-1)).toEqual({
        sessionId: 'terminal-pi',
        state: 'standby',
        source: 'session_file',
      }),
    )
    expect(harness.issues).toEqual([])
    harness.controller.dispose()
  })
})
