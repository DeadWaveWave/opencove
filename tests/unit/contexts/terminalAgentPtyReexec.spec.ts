import { describe, expect, it, vi } from 'vitest'
import type {
  TerminalAgentActivityFence,
  TerminalForegroundEvent,
  TerminalSessionMetadataEvent,
} from '../../../src/shared/contracts/dto'
import {
  buildTerminalAgentReentryCommand,
  reexecTerminalAgentInPty,
  type TerminalAgentPtyReexecRuntime,
} from '../../../src/contexts/agent/application/terminalAgentPtyReexec'

const expectedActivity: TerminalAgentActivityFence = {
  provider: 'codex',
  invocationId: 'invocation-1',
  generation: 1,
  phase: 'active',
  observedAtMs: 100,
  sourceRevision: 1,
  revision: 1,
}

type RuntimeEmitters = {
  metadata: (event: TerminalSessionMetadataEvent) => void
  foreground: (event: TerminalForegroundEvent) => void
  exit: (event: { sessionId: string; exitCode: number }) => void
}

function createRuntime(
  onInterrupt: (emit: RuntimeEmitters) => void,
  onProbe?: (emit: RuntimeEmitters) => void,
): TerminalAgentPtyReexecRuntime & { write: ReturnType<typeof vi.fn> } {
  let metadataListener: ((event: TerminalSessionMetadataEvent) => void) | null = null
  let foregroundListener: ((event: TerminalForegroundEvent) => void) | null = null
  let exitListener: ((event: { sessionId: string; exitCode: number }) => void) | null = null
  const emitters = (): RuntimeEmitters => ({
    metadata: event => metadataListener?.(event),
    foreground: event => foregroundListener?.(event),
    exit: event => exitListener?.(event),
  })
  const write = vi.fn(async (_sessionId: string, data: string) => {
    if (data === '\u0003' || data === '\u0015cd .\r') {
      onInterrupt(emitters())
    }
  })
  return {
    write,
    ...(onProbe ? { probeForeground: () => onProbe(emitters()) } : {}),
    onMetadata: listener => {
      metadataListener = listener
      return () => {
        metadataListener = null
      }
    },
    onForeground: listener => {
      foregroundListener = listener
      return () => {
        foregroundListener = null
      }
    },
    onExit: listener => {
      exitListener = listener
      return () => {
        exitListener = null
      }
    },
  }
}

function exitedMetadata(): TerminalSessionMetadataEvent {
  return {
    sessionId: 'pty-1',
    resumeSessionId: 'session-1',
    terminalAgentActivity: {
      ...expectedActivity,
      phase: 'exited',
      observedAtMs: 120,
      sourceRevision: 2,
      revision: 2,
      identityAuthority: 'provider_session_start',
    },
  }
}

function shellPrompt(): TerminalForegroundEvent {
  return {
    sessionId: 'pty-1',
    observedAtMs: 130,
    source: 'process_scan',
    exitCode: null,
    availability: 'available',
    agent: null,
    shellOnly: true,
  }
}

describe('terminal agent in-PTY re-exec', () => {
  it.each([
    ['claude-code', 'claude --resume session-1'],
    ['codex', 'codex resume session-1'],
    ['opencode', 'opencode --session session-1 .'],
    ['gemini', 'gemini --resume session-1'],
    ['pi', 'pi --session session-1'],
    ['kimi', 'kimi --session session-1'],
  ] as const)('builds the %s explicit resume command', (provider, expected) => {
    expect(buildTerminalAgentReentryCommand({ provider, resumeSessionId: 'session-1' })).toBe(
      expected,
    )
  })

  it('requires both authenticated invocation exit and a fresh shell prompt before re-entry', async () => {
    const runtime = createRuntime(emit => {
      emit.foreground(shellPrompt())
      emit.metadata(exitedMetadata())
    })

    await expect(
      reexecTerminalAgentInPty({
        sessionId: 'pty-1',
        provider: 'codex',
        resumeSessionId: 'session-1',
        expectedActivity,
        runtime,
        now: () => 100,
      }),
    ).resolves.toBe('reexecuted')

    expect(runtime.write).toHaveBeenNthCalledWith(1, 'pty-1', '\u0003')
    expect(runtime.write).toHaveBeenNthCalledWith(2, 'pty-1', '\u0015codex resume session-1\r')
  })

  it('rejects a newer invocation observed while waiting without injecting a command', async () => {
    const runtime = createRuntime(emit => {
      emit.metadata({
        ...exitedMetadata(),
        terminalAgentActivity: {
          ...exitedMetadata().terminalAgentActivity!,
          invocationId: 'invocation-2',
          generation: 2,
          phase: 'active',
        },
      })
    })

    await expect(
      reexecTerminalAgentInPty({
        sessionId: 'pty-1',
        provider: 'codex',
        resumeSessionId: 'session-1',
        expectedActivity,
        runtime,
        now: () => 100,
      }),
    ).resolves.toBe('rejected_stale_activity')
    expect(runtime.write).toHaveBeenCalledTimes(1)
  })

  it('uses a fresh shell-prompt observation as the honest fallback without activity evidence', async () => {
    const runtime = createRuntime(emit => emit.foreground(shellPrompt()))
    await expect(
      reexecTerminalAgentInPty({
        sessionId: 'pty-1',
        provider: 'pi',
        resumeSessionId: null,
        expectedActivity: null,
        runtime,
        now: () => 100,
      }),
    ).resolves.toBe('reexecuted')
    expect(runtime.write).toHaveBeenNthCalledWith(2, 'pty-1', '\u0015pi\r')
  })

  it('does not treat a weak Windows probe as shell authority without activity evidence', async () => {
    vi.useFakeTimers()
    const runtime = createRuntime(emit =>
      emit.foreground({
        sessionId: 'pty-1',
        observedAtMs: 130,
        source: 'windows_prompt_timeout',
        exitCode: null,
        availability: 'unavailable',
        agent: null,
        shellOnly: false,
      }),
    )
    const result = reexecTerminalAgentInPty({
      sessionId: 'pty-1',
      provider: 'pi',
      resumeSessionId: null,
      expectedActivity: null,
      runtime,
      timeoutMs: 10,
      now: () => 100,
    })

    await vi.advanceTimersByTimeAsync(11)
    await expect(result).resolves.toBe('drop_back_timeout')
    expect(runtime.write).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('probes for a fresh shell prompt before re-entering an already-exited invocation', async () => {
    const runtime = createRuntime(emit => emit.foreground(shellPrompt()))
    await expect(
      reexecTerminalAgentInPty({
        sessionId: 'pty-1',
        provider: 'codex',
        resumeSessionId: 'session-1',
        expectedActivity: { ...expectedActivity, phase: 'exited' },
        runtime,
        now: () => 100,
      }),
    ).resolves.toBe('reexecuted')
    expect(runtime.write).toHaveBeenNthCalledWith(1, 'pty-1', '\u0015cd .\r')
    expect(runtime.write).toHaveBeenNthCalledWith(2, 'pty-1', '\u0015codex resume session-1\r')
  })

  it('polls the runtime foreground probe until the exited shell is confirmed', async () => {
    vi.useFakeTimers()
    let probeCount = 0
    const runtime = createRuntime(
      () => undefined,
      emit => {
        probeCount += 1
        if (probeCount === 2) {
          emit.foreground(shellPrompt())
        }
      },
    )
    const result = reexecTerminalAgentInPty({
      sessionId: 'pty-1',
      provider: 'codex',
      resumeSessionId: 'session-1',
      expectedActivity: { ...expectedActivity, phase: 'exited' },
      runtime,
      now: () => 100,
    })

    await vi.advanceTimersByTimeAsync(251)
    await expect(result).resolves.toBe('reexecuted')
    expect(probeCount).toBe(2)
    vi.useRealTimers()
  })

  it('does not inject for an exited invocation without shell-prompt evidence', async () => {
    vi.useFakeTimers()
    const runtime = createRuntime(() => undefined)
    const result = reexecTerminalAgentInPty({
      sessionId: 'pty-1',
      provider: 'codex',
      resumeSessionId: 'session-1',
      expectedActivity: { ...expectedActivity, phase: 'exited' },
      runtime,
      timeoutMs: 10,
    })
    await vi.advanceTimersByTimeAsync(11)
    await expect(result).resolves.toBe('drop_back_timeout')
    expect(runtime.write).toHaveBeenCalledOnce()
    expect(runtime.write).toHaveBeenCalledWith('pty-1', '\u0015cd .\r')
    vi.useRealTimers()
  })

  it('times out without injecting when no fresh shell prompt is confirmed', async () => {
    vi.useFakeTimers()
    const runtime = createRuntime(() => undefined)
    const result = reexecTerminalAgentInPty({
      sessionId: 'pty-1',
      provider: 'codex',
      resumeSessionId: 'session-1',
      expectedActivity,
      runtime,
      timeoutMs: 10,
      now: () => 100,
    })
    await vi.advanceTimersByTimeAsync(11)
    await expect(result).resolves.toBe('drop_back_timeout')
    expect(runtime.write).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
