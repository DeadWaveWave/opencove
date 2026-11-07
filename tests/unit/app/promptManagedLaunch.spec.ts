// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'
import { createHeadlessPtyRuntime } from '../../../src/app/worker/headlessPtyRuntime'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import { PromptDeliveryService } from '../../../src/contexts/agent/application/PromptDeliveryService'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

vi.mock('../../../src/contexts/terminal/presentation/main-ipc/sessionStateWatcher', () => ({
  createSessionStateWatcherController: () => ({
    start() {},
    noteInteraction() {},
    disposeSession() {},
    dispose() {},
  }),
}))
vi.mock('../../../src/platform/terminal/TerminalProfileResolver', () => ({
  TerminalProfileResolver: class {
    listProfiles = vi.fn()
  },
}))
afterEach(() => {
  vi.useRealTimers()
})
const capability = () => ({ supported: true as const, submitDelayMs: 300 })

it.each(['codex', 'claude-code'] as const)(
  '%s plain shell -> shim -> Stop remains unsupported, including confirmed shell-only foreground',
  async provider => {
    const engine = new FakeTerminalProcessEngine()
    const pty = createHeadlessPtyRuntime({ processEngine: engine })
    const hub = new PtyStreamHub({ ptyRuntime: pty, replayWindowMaxBytes: 64000 })
    const invocations = new TerminalAgentInvocationRegistry()
    const dispose = [
      pty.onMetadata(e => hub.registerSessionAgentMetadata(e)),
      pty.onState(e => hub.registerSessionAgentState(e)),
      pty.onForeground(e => hub.registerSessionForeground(e)),
      invocations.onMetadata(e => hub.registerSessionAgentMetadata(e)),
    ]
    const service = new PromptDeliveryService({
      runs: hub.agentRuns.registry,
      input: hub,
      capability,
      now: Date.now,
      createDeliveryId: () => 'd',
      schedule: (cb, ms) => {
        const timer = setTimeout(cb, ms)
        return () => clearTimeout(timer)
      },
    })
    try {
      const { sessionId } = await pty.spawnSession({
        cwd: '/tmp',
        command: '/bin/zsh',
        args: [],
        cols: 80,
        rows: 24,
      })
      const terminal = invocations.reserve({ sourceId: 'shell' })
      terminal.bind(sessionId)
      terminal.beginInvocation({
        provider,
        invocationId: 'typed-agent',
        hookCoverage: 'lifecycle',
        hookInstallState: 'installed',
      })
      hub.agentRuns.setBindings([{ sessionId, nodeId: 'n', projectId: 'p', remote: false }])
      hub.registerSessionAgentState({
        sessionId,
        source: provider === 'codex' ? 'codex_hook' : 'claude_hook',
        state: 'standby',
        hookEventName: 'Stop',
        hookInstallState: 'installed',
      })
      engine.emitData({ sessionId, data: '\x1b[?2004h' })
      hub.handlePtyData(sessionId, '\x1b[?2004h')
      const refuse = async () => {
        expect(hub.agentRuns.registry.readFence({ sessionId })).toMatchObject({
          launchKind: 'terminal',
          lastTurnEnd: { hookEventName: 'Stop' },
        })
        await expect(
          service.deliver({ sessionId, text: 'must never reach the shell', timeoutMs: 15000 }),
        ).rejects.toMatchObject({
          code: 'agent.prompt_unsupported',
          details: {
            reason: 'terminal_agent_unsupported',
            pasteDispatchAttempted: false,
            submitDispatchAttempted: false,
          },
        })
        expect(engine.write).not.toHaveBeenCalled()
      }
      await refuse()
      engine.emitForeground({
        sessionId,
        shellOnly: true,
        observedAtMs: Date.now(),
        source: 'process_scan',
        availability: 'available',
        agent: null,
        exitCode: null,
      })
      await refuse()
      // Even inconsistent launch metadata cannot upgrade a typed invocation.
      hub.registerSessionAgentMetadata({
        sessionId,
        resumeSessionId: null,
        agentProvider: provider,
        agentLaunchKind: 'managed',
      })
      await refuse()
      terminal.release()
    } finally {
      service.dispose()
      dispose.forEach(stop => stop())
      pty.dispose()
      hub.agentRuns.dispose()
    }
  },
)

it.each(['codex', 'claude-code'] as const)(
  '%s managed PTY metadata allows lifecycle admission and cannot be inferred from hooks alone',
  async provider => {
    const engine = new FakeTerminalProcessEngine()
    const pty = createHeadlessPtyRuntime({ processEngine: engine })
    const hub = new PtyStreamHub({ ptyRuntime: pty, replayWindowMaxBytes: 64000 })
    const stop = pty.onMetadata(e => hub.registerSessionAgentMetadata(e))
    try {
      const { sessionId } = await pty.spawnSession({
        cwd: '/tmp',
        command: provider,
        args: [],
        cols: 80,
        rows: 24,
        agentProvider: provider,
        hookCoverage: 'lifecycle',
        hookInstallState: 'installed',
      })
      hub.registerSessionAgentState({
        sessionId,
        source: provider === 'codex' ? 'codex_hook' : 'claude_hook',
        state: 'standby',
        hookEventName: 'Stop',
      })
      expect(hub.agentRuns.registry.readFence({ sessionId })?.launchKind).toBe('managed')
      expect(
        promptAdmission(hub.agentRuns.registry.readFence({ sessionId }), capability),
      ).toBeNull()
      hub.registerSessionAgentState({
        sessionId: 'unowned',
        source: provider === 'codex' ? 'codex_hook' : 'claude_hook',
        state: 'standby',
        hookEventName: 'Stop',
      })
      expect(
        promptAdmission(hub.agentRuns.registry.readFence({ sessionId: 'unowned' }), capability),
      ).toEqual({ code: 'agent.prompt_unsupported', reason: 'terminal_agent_unsupported' })
    } finally {
      stop()
      pty.dispose()
      hub.agentRuns.dispose()
    }
  },
)
