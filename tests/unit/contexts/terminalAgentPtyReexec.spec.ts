import { describe, expect, it, vi } from 'vitest'
import {
  buildTerminalAgentReentryCommand,
  reexecTerminalAgentInPty,
} from '../../../src/contexts/workspace/presentation/renderer/utils/terminalAgentPtyReexec'

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

  it('clears a pending partial prompt line before injecting the resume command', async () => {
    const write = vi.fn(async () => undefined)

    await expect(
      reexecTerminalAgentInPty({
        sessionId: 'pty-1',
        command: 'codex resume session-1',
        write,
        waitForDropBack: async () => true,
      }),
    ).resolves.toBe('reexecuted')

    expect(write).toHaveBeenNthCalledWith(1, { sessionId: 'pty-1', data: '\u0003' })
    expect(write).toHaveBeenNthCalledWith(2, {
      sessionId: 'pty-1',
      data: '\u0015codex resume session-1\r',
    })
  })

  it('aborts without injecting when foreground-agent drop-back is not confirmed', async () => {
    const write = vi.fn(async () => undefined)

    await expect(
      reexecTerminalAgentInPty({
        sessionId: 'pty-1',
        command: 'codex resume session-1',
        write,
        waitForDropBack: async () => false,
      }),
    ).resolves.toBe('drop-back-timeout')

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith({ sessionId: 'pty-1', data: '\u0003' })
  })
})
