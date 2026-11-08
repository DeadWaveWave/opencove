import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionTurnStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateWatcher'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
})

async function fixture(content: string) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'claude-transcript-'))
  const filePath = join(directory, 'session.jsonl')
  await fs.writeFile(filePath, content)
  const records: Omit<
    ClaudeTranscriptObservation,
    'sessionId' | 'providerSessionId' | 'generation'
  >[] = []
  const watcher = new SessionTurnStateWatcher({
    provider: 'claude-code',
    sessionId: 's',
    filePath,
    onState: () => {},
    onClaudeTranscript: record => records.push(record),
  })
  disposers.push(async () => {
    watcher.dispose()
    await fs.rm(directory, { recursive: true, force: true })
  })
  watcher.start()
  return { filePath, records, watcher }
}
const enqueue = JSON.stringify({
  type: 'queue-operation',
  sessionId: 'p',
  operation: 'enqueue',
  content: 'same text',
})

it('Claude transcript records distinguish replay from appended occurrences and keep private positions', async () => {
  const f = await fixture(enqueue + '\n')
  await vi.waitFor(() => expect(f.records).toHaveLength(1))
  expect(f.records[0]).toMatchObject({
    baseline: true,
    position: 1,
    record: { kind: 'queue', operation: 'enqueue' },
  })
  await fs.appendFile(f.filePath, enqueue + '\n' + enqueue + '\n')
  await vi.waitFor(() => expect(f.records).toHaveLength(3))
  expect(f.records.slice(1).map(r => [r.position, r.baseline])).toEqual([
    [2, false],
    [3, false],
  ])
  expect(f.records[0].fileIdentity).toBe(f.records[2].fileIdentity)
  expect(JSON.stringify(f.records)).not.toContain('same text')
})

it('partial baseline records stay replay evidence when completed after watcher attachment', async () => {
  const f = await fixture(enqueue.slice(0, -2))
  // A completed irrelevant baseline record confirms that the first read has finished.
  await vi.waitFor(() =>
    expect((f.watcher as unknown as { readingBaseline: boolean }).readingBaseline).toBe(false),
  )
  await fs.appendFile(f.filePath, enqueue.slice(-2) + '\n' + enqueue + '\n')
  await vi.waitFor(() => expect(f.records).toHaveLength(2))
  expect(f.records.map(r => r.baseline)).toEqual([true, false])
})

it('transcript truncation changes file identity and reports unavailability before replay', async () => {
  const f = await fixture(enqueue + '\n' + enqueue + '\n')
  await vi.waitFor(() => expect(f.records).toHaveLength(2))
  const identity = f.records[0].fileIdentity
  await fs.writeFile(f.filePath, enqueue + '\n')
  await vi.waitFor(() => expect(f.records).toHaveLength(4))
  expect(f.records[2]).toMatchObject({ unavailable: true, baseline: true })
  expect(f.records[3]).toMatchObject({ baseline: true, position: 1 })
  expect(f.records[3].fileIdentity).not.toBe(identity)
})

it('disposed transcript watcher cannot emit appended records', async () => {
  const f = await fixture(enqueue + '\n')
  await vi.waitFor(() => expect(f.records).toHaveLength(1))
  f.watcher.dispose()
  await fs.appendFile(f.filePath, enqueue + '\n')
  expect(f.records).toHaveLength(1)
})

it('transcript parser rejects subagent records and retains unknown queue operations as uncertainty', () => {
  expect(parseClaudeTranscript('{"type":"queue-operation","operation":"clear"}')).toEqual({
    kind: 'queue',
    operation: 'unknown',
  })
  expect(
    parseClaudeTranscript(
      '{"type":"user","promptId":"A","promptSource":"queued","isSidechain":true}',
    ),
  ).toBeUndefined()
  expect(
    parseClaudeTranscript('{"type":"user","promptId":"invalid id","promptSource":"queued"}'),
  ).toEqual({ kind: 'invalid_user' })
  expect(parseClaudeTranscript('invalid')).toBeUndefined()
})
