// @vitest-environment node
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { SessionTurnStateWatcher } from '../../src/contexts/agent/infrastructure/watchers/SessionTurnStateWatcher'
import { AgentRunStateRegistry } from '../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../src/contexts/agent/application/AgentRunStateRuntime'
import type { AgentRunEvent } from '../../src/shared/contracts/dto/agentRunState'

function records(provider: 'claude-code' | 'codex') {
  return provider === 'claude-code'
    ? [
        { type: 'user', message: { content: 'historical prompt' } },
        { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text' }] } },
      ]
    : [
        { type: 'event_msg', payload: { type: 'task_started' } },
        { type: 'event_msg', payload: { type: 'task_complete' } },
      ]
}
const encode = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n'

async function fixture(provider: 'claude-code' | 'codex', content: string, live = false) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'opencove-startup-baseline-'))
  const path = join(directory, 'session.jsonl')
  await fs.writeFile(path, content)
  let turn = 0
  const registry = new AgentRunStateRegistry({
    epoch: 'worker',
    now: Date.now,
    createTurnId: () => `turn-${++turn}`,
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, Date.now)
  runtime.metadata({ sessionId: 's', agentProvider: provider, resumeSessionId: 'saved' })
  const events: AgentRunEvent[] = []
  registry.subscribe({ epoch: 'worker', afterSeq: registry.list().seq }, {}, event => {
    if (event.type !== 'resync_required') {
      events.push(event)
    }
  })
  const states: string[] = []
  const watcher = new SessionTurnStateWatcher({
    provider,
    sessionId: 's',
    filePath: path,
    initialRead: live ? 'live' : 'baseline',
    onState(sessionId, state, options) {
      states.push(state)
      runtime.observe({ sessionId, state, source: 'session_file', ...options })
    },
  })
  const drain = async () => {
    await vi.waitFor(() =>
      expect((watcher as unknown as { processing: boolean }).processing).toBe(false),
    )
  }
  watcher.start()
  await drain()
  return {
    path,
    watcher,
    states,
    events,
    runtime,
    registry,
    drain,
    completed: () => events.filter(event => event.type === 'agent.turn_completed'),
    async dispose() {
      watcher.dispose()
      runtime.dispose()
      registry.dispose()
      await fs.rm(directory, { recursive: true, force: true })
    },
  }
}

it.each(['claude-code', 'codex'] as const)(
  '%s folds history across read chunks without manufacturing work or completion',
  async provider => {
    const history = Array.from({ length: 800 }, () => records(provider)).flat()
    const f = await fixture(provider, encode(history))
    try {
      expect(f.states).toEqual(['standby'])
      expect(f.completed()).toEqual([])
      expect(f.registry.get({ sessionId: 's' })).toMatchObject({
        state: 'idle',
        lastEndedTurn: null,
      })
      await fs.appendFile(f.path, encode(records(provider)))
      f.watcher.refresh()
      await f.drain()
      expect(f.completed()).toHaveLength(1)
      expect(f.states).toEqual(['standby', 'working', 'standby'])
    } finally {
      await f.dispose()
    }
  },
)

it('a rewritten historical file cannot close an active turn or manufacture another', async () => {
  const f = await fixture('codex', encode(records('codex')))
  try {
    await fs.appendFile(f.path, encode([records('codex')[0]]))
    f.watcher.refresh()
    await f.drain()
    const turn = f.registry.get({ sessionId: 's' })?.turn
    expect(turn).not.toBeNull()
    await fs.writeFile(f.path, encode(records('codex')))
    f.watcher.refresh()
    await f.drain()
    expect(f.completed()).toEqual([])
    expect(f.registry.get({ sessionId: 's' })?.turn).toEqual(turn)
  } finally {
    await f.dispose()
  }
})

it('a partial historical Codex start stays a baseline when completed after attachment', async () => {
  const line = JSON.stringify(records('codex')[0])
  const f = await fixture('codex', line.slice(0, -2))
  try {
    expect(f.states).toEqual([])
    await fs.appendFile(f.path, line.slice(-2, -1))
    f.watcher.refresh()
    await f.drain()
    expect(f.states).toEqual([])
    await fs.appendFile(f.path, line.slice(-1) + '\n' + encode([records('codex')[1]]))
    f.watcher.refresh()
    await f.drain()
    expect(f.completed()).toEqual([])
    expect(f.registry.get({ sessionId: 's' })?.lastEndedTurn).toBeNull()
  } finally {
    await f.dispose()
  }
})

it('a new Codex invocation observes a fast complete turn in its first read', async () => {
  const f = await fixture('codex', encode(records('codex')), true)
  try {
    expect(f.completed()).toHaveLength(1)
    expect(f.registry.get({ sessionId: 's' })).toMatchObject({
      state: 'idle',
      lastEndedTurn: { id: 'turn-1' },
    })
  } finally {
    await f.dispose()
  }
})
