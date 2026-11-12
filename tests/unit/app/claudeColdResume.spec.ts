// @vitest-environment node
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'
import { hookChannelFixture } from './claudeHookTranscript.helpers'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) {
    // eslint-disable-next-line no-await-in-loop -- close observers before removing transcript roots
    await dispose()
  }
})

it.each([true, false])(
  'cold managed resume accepts a headerless Stop without prompt submission (trusted transcript=%s)',
  async trusted => {
    const root = await fs.mkdtemp(join(tmpdir(), 'claude-cold-resume-'))
    cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
    const project = join(root, 'projects', 'workspace')
    const path = join(project, 'provider.jsonl')
    await fs.mkdir(project, { recursive: true })
    const assistant = JSON.stringify({
      type: 'assistant',
      sessionId: 'provider',
      message: { content: [{ type: 'text', text: 'reply' }], stop_reason: 'end_turn' },
    })
    await fs.writeFile(path, `${assistant}\n`)

    const launch = async (sessionId: string, registered: boolean) => {
      const f = await hookChannelFixture({
        environment: { CLAUDE_CONFIG_DIR: trusted ? root : join(root, 'other') },
      })
      const registry = new AgentRunStateRegistry({
        epoch: sessionId,
        now: Date.now,
        createTurnId: () => 'unexpected-turn',
        schedule: () => () => {},
      })
      const runtime = new AgentRunStateRuntime(registry, Date.now)
      const records: ClaudeTranscriptObservation[] = []
      const completed: unknown[] = []
      f.channel.onState(event => runtime.observe(event))
      f.channel.onClaudeTranscript?.(record => {
        records.push(record)
        runtime.observeClaudeTranscript(record)
      })
      registry.subscribe(
        { epoch: sessionId, afterSeq: 0 },
        { types: ['agent.turn_completed'] },
        e => completed.push(e),
      )
      const metadata = () =>
        runtime.metadata({
          sessionId,
          agentProvider: 'claude-code',
          agentLaunchKind: 'managed',
          hookCoverage: 'lifecycle',
          hookInstallState: 'installed',
          resumeSessionId: 'provider',
        })
      f.reservation.commit(sessionId)
      if (registered) {
        metadata()
      }
      const post = (name: string) =>
        f.post({
          session_id: 'provider',
          transcript_path: path,
          cwd: project,
          hook_event_name: name,
        })
      const dispose = async () => {
        runtime.dispose()
        await f.channel.dispose()
      }
      cleanup.push(dispose)
      await post('SessionStart')
      if (!registered) {
        metadata()
      }
      await vi.waitFor(() =>
        expect(records.some(r => (trusted ? r.record?.kind === 'checkpoint' : r.unavailable))).toBe(
          true,
        ),
      )
      // The general session watcher sees the appended assistant baseline, independently.
      runtime.observe({ sessionId, state: 'standby', source: 'session_file' })
      expect(await post('Stop')).toBe(204)
      expect(registry.get({ sessionId })).toMatchObject({
        state: 'idle',
        quality: 'authoritative',
        source: 'claude_hook',
        turn: null,
        lastEndedTurn: null,
      })
      expect(registry.readFence({ sessionId })?.lastTurnEnd).toMatchObject({
        source: 'claude_hook',
        hookEventName: 'Stop',
      })
      expect(completed).toEqual([])
      return dispose
    }

    // Initial spawn can publish its hooks before runtime metadata; cold recovery registers first.
    const dispose = await launch('new-pty', false)
    await dispose()
    await fs.appendFile(path, `${assistant}\n`)
    await launch('resumed-pty', true)
  },
)
