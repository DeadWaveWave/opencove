// @vitest-environment node
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import type { SessionRuntimeWrite } from '../../../src/shared/runtime/sessionInputProvenance'
import { PtyStreamInputEvidence } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamInputEvidence'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/opencove-user-data' },
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))
it('preserves encoding and provenance through the observed runtime without treating encoding as a writer', () => {
  const write = vi.fn()
  const evidence = new PtyStreamInputEvidence({
    write,
    spawnSession: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => () => {},
    onExit: () => () => {},
  })
  const listener = vi.fn()
  const stop = evidence.watch('s', listener)
  try {
    const target = { providerSessionId: 'B', invocationId: 'actual-invocation' }
    evidence.observedRuntime().write('s', 'data', 'binary', target)
    expect(write).toHaveBeenCalledWith('s', 'data', 'binary', target)
    expect(listener).toHaveBeenCalledWith(undefined, 'data')
  } finally {
    stop()
  }
})
it.each(
  ['desktop', 'headless'].flatMap(runtime =>
    [false, true].map(terminal => ({ runtime, terminal })),
  ),
)(
  'carries the admitted target through $runtime runtime, terminal invocation=$terminal',
  async ({ runtime, terminal }) => {
    vi.useFakeTimers()
    const root = await fs.mkdtemp(join(tmpdir(), 'opencove-input-provenance-'))
    const filePath = join(root, 'stale-file-id.jsonl')
    await fs.writeFile(filePath, '')
    const processEngine = new FakeTerminalProcessEngine()
    const options = {
      processEngine,
      sessionDiscovery: {
        capture: () => ({
          isCurrent: () => true,
          resolve: async () => ({ resumeSessionId: 'stale-file-id', filePath }),
        }),
      },
    }
    const pty =
      runtime === 'desktop'
        ? (
            await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')
          ).createPtyRuntime(options)
        : (await import('../../../src/app/worker/headlessPtyRuntime')).createHeadlessPtyRuntime(
            options,
          )
    const f = promptDeliveryRuntimeFixture(undefined, 'claude-code', false)
    const events: TerminalSessionStateEvent[] = []
    pty.onState?.(event => {
      events.push(event)
      f.runtime.observe(event)
    })
    pty.onClaudeTranscript?.(record => f.runtime.observeClaudeTranscript(record))
    f.write.mockImplementation((...args: Parameters<SessionRuntimeWrite>) => pty.write(...args))
    try {
      if (terminal) {
        f.runtime.metadata({
          sessionId: 's',
          resumeSessionId: null,
          agentLaunchKind: 'terminal',
          hookCoverage: 'lifecycle',
          hookInstallState: 'installed',
          terminalAgentActivity: {
            provider: 'claude-code',
            invocationId: 'terminal-invocation',
            generation: 1,
            phase: 'active',
            observedAtMs: Date.now(),
            identityAuthority: 'provider_session_start',
          },
        })
      }
      pty.startSessionStateWatcher({
        sessionId: 's',
        provider: 'claude-code',
        cwd: root,
        resumeSessionId: 'stale-file-id',
        launchMode: 'resume',
        startedAtMs: Date.now(),
      })
      await vi.advanceTimersByTimeAsync(1)
      const fence = f.registry.readFence({ sessionId: 's' })!
      const target = {
        providerSessionId: 'admitted-conversation',
        invocationId: terminal ? 'terminal-invocation' : 's',
        conversationGeneration: undefined,
      }
      await f.hub.withSessionInputOperation('s', async input => {
        input.write('\r', 'delivery', target)
      })
      const enter = f.write.mock.calls.find(call => call[1] === '\r')!
      expect(enter[3]).toEqual(target)
      expect(enter[3].invocationId).not.toBe(fence.incarnation)
      expect(
        getPromptSubmissionEvidence(events.findLast(event => event.state === 'working')!),
      ).toMatchObject(target)
      // Only bytes and encoding reach the process engine; provenance stays in-process.
      expect(processEngine.write.mock.calls.find(call => call[1] === '\r')?.slice(3)).toEqual([])
      expect(processEngine.write.mock.calls.some(call => call[1] === '\r')).toBe(true)
      await pty.write('s', '\r')
      expect(getPromptSubmissionEvidence(events.at(-1)!)).toBeUndefined()
      await pty.write('s', 'binary input', 'binary')
      expect(processEngine.write).toHaveBeenLastCalledWith('s', 'binary input', 'binary')
    } finally {
      f.dispose()
      await pty.dispose()
      await fs.rm(root, { recursive: true, force: true })
      vi.useRealTimers()
    }
  },
)
