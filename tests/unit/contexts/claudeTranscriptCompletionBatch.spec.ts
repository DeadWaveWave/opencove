// @vitest-environment node
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { SessionTurnStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateWatcher'
import { claudeTranscriptAccess } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'
import { continuationFixture } from './claudeTurnContinuation.helpers'

it.each([false, true])(
  'a complete delayed watcher read cannot admit a prompt mid-batch (expired=%s)',
  async expired => {
    const f = continuationFixture(),
      root = await fs.mkdtemp(join(tmpdir(), 'claude-batch-'))
    const project = join(root, 'projects', 'p'),
      path = join(project, 'provider.jsonl')
    await fs.mkdir(project, { recursive: true })
    await fs.writeFile(path, '{}\n')
    let checkpoints = 0
    const states: string[] = []
    const watcher = new SessionTurnStateWatcher({
      provider: 'claude-code',
      sessionId: 's',
      filePath: path,
      fileAccess: claudeTranscriptAccess(path, 'provider', [root]),
      checkpoint: true,
      onState() {},
      onClaudeTranscript(record) {
        f.runtime.observeClaudeTranscript({
          ...record,
          sessionId: 's',
          incarnation: 's',
          providerSessionId: 'provider',
          generation: 2,
          origin: 'hook',
        })
        if (record.record?.kind === 'checkpoint') {
          checkpoints++
        }
        states.push(f.snapshot().state)
      },
    })
    try {
      watcher.start()
      await vi.waitFor(() => expect(checkpoints).toBe(1))
      f.hook('UserPromptSubmit', 'A')
      f.hook('UserPromptSubmit', 'A')
      f.hook('Stop', 'A', 'first')
      f.hook('Stop', 'B', 'ACK')
      if (expired) {
        f.tick(5001)
      }
      states.length = 0
      await fs.appendFile(
        path,
        [
          { type: 'queue-operation', operation: 'enqueue' },
          { type: 'queue-operation', operation: 'dequeue' },
          { type: 'user', promptId: 'B', promptSource: 'queued', uuid: 'user-b' },
          { type: 'queue-operation', operation: 'enqueue' },
          { type: 'assistant', parentUuid: 'user-b', message: { stop_reason: 'end_turn' } },
        ]
          .map(record => JSON.stringify(record))
          .join('\n') + '\n',
      )
      watcher.refresh()
      await vi.waitFor(() => expect(checkpoints).toBe(2))
      expect(states).not.toContain('idle')
      expect(f.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
    } finally {
      watcher.dispose()
      f.runtime.dispose()
      await fs.rm(root, { recursive: true, force: true })
    }
  },
)
