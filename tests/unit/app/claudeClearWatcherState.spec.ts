// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createSessionStateWatcherController } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import { createSessionFileStateWatcher } from '../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherProvider'
import {
  getPromptSubmissionEvidence,
  setPromptSubmissionEvidence,
} from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import { clearIngressFixture } from './claudeClearIngress.helpers'

vi.mock('../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcherProvider', () => ({
  createSessionFileStateWatcher: vi.fn(() => ({ start: vi.fn(), dispose: vi.fn() })),
}))
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(close => close()))
  vi.clearAllMocks()
})
async function fixture(delayed = false) {
  const f = await clearIngressFixture()
  cleanups.push(f.close)
  const events: TerminalSessionStateEvent[] = []
  let resolveDiscovery!: (value: { resumeSessionId: string; filePath: string }) => void
  const discovery = delayed
    ? new Promise<{ resumeSessionId: string; filePath: string }>(resolve => {
        resolveDiscovery = resolve
      })
    : Promise.resolve({ resumeSessionId: 'A', filePath: 'A.jsonl' })
  const controller = createSessionStateWatcherController({
    sendToAllWindows: vi.fn(),
    reportIssue: vi.fn(),
    onClaudeTranscript: record => f.runtime.observeClaudeTranscript(record),
    sessionDiscovery: {
      capture: () => ({ isCurrent: () => true, resolve: async () => discovery }),
    },
    onState: event => {
      events.push(event)
      f.runtime.observe(event)
    },
  })
  cleanups.push(async () => controller.dispose())
  controller.start({
    sessionId: 's',
    provider: 'claude-code',
    cwd: '/workspace',
    launchMode: 'resume',
    resumeSessionId: 'A',
    startedAtMs: Date.now(),
  })
  await vi.advanceTimersByTimeAsync(0)
  return {
    ...f,
    events,
    resolveDiscovery,
    get watcher() {
      return vi.mocked(createSessionFileStateWatcher).mock.calls[0][0]
    },
  }
}
it.each(['state', 'unavailable', 'error'] as const)(
  'fences predecessor watcher %s before any live mutation',
  async kind => {
    const f = await fixture()
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    const before = f.fence()
    if (kind === 'state') {
      f.watcher.onState('s', 'working')
    }
    if (kind === 'unavailable') {
      f.watcher.onUnavailable('s')
    }
    if (kind === 'error') {
      f.watcher.onError(new Error('A read failed'))
    }
    expect(f.fence()).toEqual(before)
    expect(getPromptSubmissionEvidence(f.events.at(-1)!)).toMatchObject({
      providerSessionId: 'A',
      conversationGeneration: 0,
    })
  },
)
it.each([false, true])(
  'fences unversioned file state/error at direct registry ingress (degraded=%s)',
  async degraded => {
    const f = await fixture()
    await f.send('B', 'SessionStart', 10, undefined, 'clear')
    const before = f.fence()
    f.registry.observe('s', {
      incarnation: 's',
      source: 'session_file',
      state: degraded ? 'unknown' : 'working',
      degraded,
      sourceSequence: 100,
      observedAt: Date.now(),
    })
    expect(f.fence()).toEqual(before)
  },
)
it('checks provenance before file metadata can degrade the hook context or legacy projection', async () => {
  const f = await fixture()
  await f.send('B', 'SessionStart', 10, undefined, 'clear')
  const before = f.fence()
  const stale: TerminalSessionStateEvent = {
    sessionId: 's',
    source: 'session_file',
    state: 'working',
    hookInstallState: 'error',
    degraded: true,
  }
  setPromptSubmissionEvidence(stale, { providerSessionId: 'A', conversationGeneration: 0 })
  f.runtime.observe(stale)
  expect(f.fence()).toEqual(before)
  const current: TerminalSessionStateEvent = {
    sessionId: 's',
    source: 'session_file',
    state: 'standby',
    degraded: true,
  }
  setPromptSubmissionEvidence(current, {
    providerSessionId: 'B',
    conversationGeneration: before.conversationGeneration,
  })
  f.runtime.observe(current)
  expect(f.fence().claudeClearReady).toBe(false)
})

it('captures provenance before an async discovery gap, not when a stale callback runs', async () => {
  const f = await fixture(true)
  await f.send('B', 'SessionStart', 10, undefined, 'clear')
  const before = f.fence()
  f.resolveDiscovery({ resumeSessionId: 'A', filePath: 'A.jsonl' })
  await vi.advanceTimersByTimeAsync(0)
  f.watcher.onState('s', 'working')
  expect(getPromptSubmissionEvidence(f.events.at(-1)!)).toMatchObject({
    providerSessionId: 'A',
    conversationGeneration: 0,
  })
  expect(f.fence()).toEqual(before)
})
