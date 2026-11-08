// @vitest-environment node
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { SessionTurnStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateWatcher'
import { claudeTranscriptAccess } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'
import { continuationFixture, enqueue } from './claudeTurnContinuation.helpers'

it('a late transcript baseline with more than 64 historical queued users recovers at the actual final EOF', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'claude-history-recovery-')),
    f = continuationFixture()
  const project = join(root, 'projects', 'p'),
    path = join(project, 'provider.jsonl')
  await fs.mkdir(project, { recursive: true })
  const records: unknown[] = []
  for (let n = 0; n <= 80; n++) {
    const id = n === 80 ? 'B' : `historical-${n}`
    records.push(
      { type: 'queue-operation', operation: 'enqueue' },
      { type: 'queue-operation', operation: 'dequeue' },
      { type: 'user', promptId: id, promptSource: 'queued', uuid: id },
      { type: 'assistant', parentUuid: id, message: { stop_reason: 'end_turn' } },
    )
  }
  await fs.writeFile(path, records.map(record => JSON.stringify(record)).join('\n') + '\n')
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'first')
  f.tick(5001)
  f.hook('Stop', 'B', 'final')
  let checkpoint:
    | { kind: 'checkpoint'; promptId?: string; queueEmpty: boolean; final: boolean }
    | undefined
  const watcher = new SessionTurnStateWatcher({
    sessionId: 's',
    provider: 'claude-code',
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
        checkpoint = record.record
      }
    },
  })
  try {
    watcher.start()
    await vi.waitFor(() =>
      expect(checkpoint).toMatchObject({ promptId: 'B', queueEmpty: true, final: true }),
    )
    expect(f.snapshot()).toMatchObject({
      state: 'idle',
      quality: 'authoritative',
      lastEndedTurn: { id: 't1', outcome: 'unknown' },
    })
  } finally {
    watcher.dispose()
    f.runtime.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})
