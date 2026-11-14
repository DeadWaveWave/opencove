// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import { ClaudeHookTranscriptObserver } from '../../../src/app/main/controlSurface/agentHook/ClaudeHookTranscriptObserver'

const watchers = vi.hoisted(
  () => [] as Array<{ options: Record<string, unknown>; dispose: () => void }>,
)
vi.mock('../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateWatcher', () => ({
  SessionTurnStateWatcher: class {
    constructor(readonly options: Record<string, unknown>) {
      watchers.push(this)
    }
    start() {}
    refresh() {}
    dispose = vi.fn()
  },
}))
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()))
  watchers.length = 0
})
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'claude-observer-boundary-'))
  const config = join(root, 'config'),
    project = join(config, 'projects', 'workspace')
  await fs.mkdir(project, { recursive: true })
  const path = join(project, 'provider.jsonl')
  await fs.writeFile(path, '{}\n')
  const emit = vi.fn(),
    observer = new ClaudeHookTranscriptObserver(emit, [config])
  cleanup.push(async () => {
    observer.dispose()
    await fs.rm(root, { recursive: true, force: true })
  })
  const context = {
    incarnation: 'invocation-X',
    isCurrent: () => true,
    configDirectories: [config],
  }
  const hook = (transcriptPath = path) => ({
    version: 1 as const,
    state: null,
    hookEventName: 'SessionStart',
    claudeSessionId: 'provider',
    transcriptPath,
  })
  const stale = (event: ReturnType<typeof hook> & { emittedAtMs?: number }) => {
    const offset = emit.mock.calls.length
    const result = observer.observe('s', event, context)
    for (const [record] of emit.mock.calls.slice(offset)) {
      expect(record.conversation).toBeDefined()
      expect(record.record).toBeUndefined()
      expect(record.lifecycle).toBeUndefined()
      expect(record.unavailable).toBeUndefined()
      expect(record.reading).toBeUndefined()
    }
    return result
  }
  return { root, project, path, observer, context, emit, hook, stale }
}
it('a retired terminal invocation cannot emit watcher records or watcher errors', async () => {
  const f = await fixture()
  let current = true
  f.observer.observe('s', f.hook(), { ...f.context, isCurrent: () => current })
  await vi.waitFor(() => expect(watchers).toHaveLength(1))
  f.emit.mockClear()
  current = false
  const options = watchers[0].options
  expect((options.shouldPoll as () => boolean)()).toBe(false)
  ;(options.onClaudeTranscript as (record: unknown) => void)({
    fileIdentity: 'f',
    position: 1,
    baseline: false,
    record: { kind: 'queue', operation: 'enqueue' },
  })
  ;(options.onError as (error: Error) => void)(new Error('late'))
  expect(f.emit).not.toHaveBeenCalled()
})
it.each([
  'outside',
  'wrong-name',
  'symlink',
  'directory',
  ...(process.platform === 'win32' ? [] : ['fifo']),
])('unsafe transcript capability is rejected before watcher IO: %s', async kind => {
  const f = await fixture()
  let path = f.path
  if (kind === 'outside') {
    path = join(f.root, 'provider.jsonl')
    await fs.writeFile(path, '{}')
  }
  if (kind === 'wrong-name') {
    path = join(f.project, 'wrong.jsonl')
    await fs.writeFile(path, '{}')
  }
  if (kind === 'symlink') {
    await fs.rm(path)
    const other = join(f.root, 'secret')
    await fs.writeFile(other, '{}')
    await fs.symlink(other, path)
  }
  if (kind === 'directory') {
    await fs.rm(path)
    await fs.mkdir(path)
  }
  if (kind === 'fifo') {
    await fs.rm(path)
    execFileSync('mkfifo', [path])
  }
  f.observer.observe('s', f.hook(path), f.context)
  await vi.waitFor(() =>
    expect(f.emit).toHaveBeenCalledWith(expect.objectContaining({ unavailable: true })),
  )
  expect(watchers).toHaveLength(0)
})
it('SessionEnd detaches and an ordered new SessionStart establishes a new generation while retired-session hooks are rejected', async () => {
  const f = await fixture()
  f.observer.observe('s', f.hook(), f.context)
  await vi.waitFor(() => expect(watchers).toHaveLength(1))
  expect(
    f.observer.observe(
      's',
      { ...f.hook(), hookEventName: 'SessionEnd', emittedAtMs: 100 },
      f.context,
    ),
  ).toBe(true)
  expect(watchers[0].dispose).toHaveBeenCalledOnce()
  const nextPath = join(f.project, 'next.jsonl')
  await fs.writeFile(nextPath, '{}')
  expect(f.stale({ ...f.hook(nextPath), claudeSessionId: 'next', emittedAtMs: 99 })).toBe(
    'state_only',
  )
  expect(
    f.observer.observe(
      's',
      { ...f.hook(nextPath), claudeSessionId: 'next', emittedAtMs: 101 },
      f.context,
    ),
  ).toBe(true)
  await vi.waitFor(() => expect(watchers).toHaveLength(2))
  expect(f.stale({ ...f.hook(), hookEventName: 'Stop', emittedAtMs: 102 })).toBe('state_only')
  const callback = watchers[1].options.onClaudeTranscript as (record: unknown) => void
  callback({ fileIdentity: 'f2', position: 1, baseline: false })
  expect(f.emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ providerSessionId: 'next', incarnation: 'invocation-X' }),
  )
})
it('an actual record preserves its originating invocation incarnation', async () => {
  const f = await fixture()
  f.observer.observe('s', f.hook(), f.context)
  await vi.waitFor(() => expect(watchers).toHaveLength(1))
  ;(watchers[0].options.onClaudeTranscript as (record: unknown) => void)({
    fileIdentity: 'f',
    position: 1,
    baseline: false,
  })
  expect(f.emit).toHaveBeenLastCalledWith(expect.objectContaining({ incarnation: 'invocation-X' }))
})
it('fresh starts resume a prior provider identity and retire its earlier watcher generation', async () => {
  const f = await fixture()
  f.observer.observe('s', { ...f.hook(), emittedAtMs: 100 }, f.context)
  await vi.waitFor(() => expect(watchers).toHaveLength(1))
  const old = watchers[0].options.onClaudeTranscript as (record: unknown) => void
  f.observer.observe('s', { ...f.hook(), hookEventName: 'SessionEnd', emittedAtMs: 101 }, f.context)
  f.observer.observe('s', { ...f.hook(), emittedAtMs: 102 }, f.context)
  await vi.waitFor(() => expect(watchers).toHaveLength(2))
  f.emit.mockClear()
  old({ fileIdentity: 'old', position: 10, baseline: false })
  expect(f.emit).not.toHaveBeenCalled()
  expect(f.stale({ ...f.hook(), emittedAtMs: 100 })).toBe('state_only')
  expect(f.stale({ ...f.hook(), hookEventName: 'Stop' })).toBe('state_only')
  expect(watchers).toHaveLength(2)
})
it('retired observer generations evict oldest entries without disabling long-lived observation', async () => {
  const f = await fixture()
  for (let n = 0; n < 70; n++) {
    expect(f.observer.observe('s', { ...f.hook(), emittedAtMs: 100 + n * 2 }, f.context)).toBe(true)
    // Each asynchronous attachment may lose ownership before it finishes, just as a rapid /clear.
    expect(
      f.observer.observe(
        's',
        { ...f.hook(), hookEventName: 'SessionEnd', emittedAtMs: 101 + n * 2 },
        f.context,
      ),
    ).toBe(true)
  }
  expect(f.observer.observe('s', { ...f.hook(), emittedAtMs: 300 }, f.context)).toBe(true)
  await vi.waitFor(() => expect(watchers).toHaveLength(1))
  expect(watchers[0].dispose).not.toHaveBeenCalled()
})
it('provider A can resume after provider B while both retired generations stay fenced', async () => {
  const f = await fixture(),
    nextPath = join(f.project, 'next.jsonl')
  await fs.writeFile(nextPath, '{}\n')
  f.observer.observe('s', { ...f.hook(), emittedAtMs: 100 }, f.context)
  await vi.waitFor(() => expect(watchers).toHaveLength(1))
  f.observer.observe('s', { ...f.hook(), hookEventName: 'SessionEnd', emittedAtMs: 101 }, f.context)
  f.observer.observe(
    's',
    { ...f.hook(nextPath), claudeSessionId: 'next', emittedAtMs: 102 },
    f.context,
  )
  await vi.waitFor(() => expect(watchers).toHaveLength(2))
  f.observer.observe(
    's',
    { ...f.hook(nextPath), claudeSessionId: 'next', hookEventName: 'SessionEnd', emittedAtMs: 103 },
    f.context,
  )
  expect(f.observer.observe('s', { ...f.hook(), emittedAtMs: 104 }, f.context)).toBe(true)
  await vi.waitFor(() => expect(watchers).toHaveLength(3))
  f.emit.mockClear()
  for (const old of watchers.slice(0, 2)) {
    ;(old.options.onClaudeTranscript as (record: unknown) => void)({
      fileIdentity: 'old',
      position: 50,
      baseline: false,
    })
  }
  expect(f.emit).not.toHaveBeenCalled()
  expect(f.stale({ ...f.hook(), hookEventName: 'Stop', emittedAtMs: 102 })).toBe('state_only')
})

it('preserves main channel state while rejecting stale private observer IO without any clear', async () => {
  const f = await fixture()
  const channel = await hookChannelFixture({
    environment: { CLAUDE_CONFIG_DIR: join(f.root, 'config') },
  })
  const state = vi.fn(),
    records = vi.fn()
  channel.channel.onState(state)
  channel.channel.onClaudeTranscript?.(records)
  channel.reservation.commit('s')
  const send = (id: string, name: string, at: number) =>
    channel.post(
      {
        session_id: id,
        hook_event_name: name,
        source: 'startup',
        cwd: '/',
        transcript_path: join(f.project, `${id}.jsonl`),
      },
      at,
    )
  try {
    await send('provider', 'SessionStart', 100)
    await send('provider', 'SessionEnd', 101)
    await send('next', 'SessionStart', 102)
    records.mockClear()
    await send('provider', 'Stop', 103)
    expect(state.mock.calls.map(([e]) => [e.hookEventName, e.state])).toEqual([
      ['SessionEnd', 'standby'],
      ['Stop', 'standby'],
    ])
    expect(getPromptSubmissionEvidence(state.mock.calls.at(-1)![0])?.providerSessionId).toBe(
      'provider',
    )
    for (const [record] of records.mock.calls) {
      expect(record.conversation).toBeDefined()
      expect(record.lifecycle).toBeUndefined()
      expect(record.record).toBeUndefined()
      expect(record.unavailable).toBeUndefined()
    }
  } finally {
    await channel.channel.dispose()
  }
})
