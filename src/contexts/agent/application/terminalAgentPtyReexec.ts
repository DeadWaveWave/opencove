import type { AgentProvider } from '@contexts/settings/domain/agentSettings'

const INTERRUPT_FOREGROUND_JOB = '\u0003'
const CLEAR_PROMPT_INPUT = '\u0015'

export type TerminalAgentPtyReexecResult = 'reexecuted' | 'drop-back-timeout'

function assertSafeSessionId(sessionId: string): string {
  const normalized = sessionId.trim()
  if (!/^[A-Za-z0-9._:@/+\-=]+$/.test(normalized)) {
    throw new Error('Agent session id contains unsupported shell characters.')
  }
  return normalized
}

export function buildTerminalAgentReentryCommand(options: {
  provider: AgentProvider
  resumeSessionId: string | null
}): string {
  const resumeSessionId = options.resumeSessionId
    ? assertSafeSessionId(options.resumeSessionId)
    : null

  if (!resumeSessionId) {
    if (options.provider === 'claude-code') {
      return 'claude'
    }
    return options.provider
  }

  if (options.provider === 'claude-code') {
    return `claude --resume ${resumeSessionId}`
  }
  if (options.provider === 'codex') {
    return `codex resume ${resumeSessionId}`
  }
  if (options.provider === 'opencode') {
    return `opencode --session ${resumeSessionId} .`
  }
  if (options.provider === 'gemini') {
    return `gemini --resume ${resumeSessionId}`
  }
  return `${options.provider} --session ${resumeSessionId}`
}

export async function reexecTerminalAgentInPty(options: {
  sessionId: string
  command: string
  write: (input: { sessionId: string; data: string }) => Promise<void>
  waitForDropBack: () => Promise<boolean>
}): Promise<TerminalAgentPtyReexecResult> {
  await options.write({
    sessionId: options.sessionId,
    data: INTERRUPT_FOREGROUND_JOB,
  })

  if (!(await options.waitForDropBack())) {
    return 'drop-back-timeout'
  }

  await options.write({
    sessionId: options.sessionId,
    data: `${CLEAR_PROMPT_INPUT}${options.command}\r`,
  })
  return 'reexecuted'
}

export async function enterTerminalAgentInFreshPty(options: {
  sessionId: string
  command: string
  waitForShellReady: () => Promise<void>
  write: (input: { sessionId: string; data: string }) => Promise<void>
}): Promise<void> {
  await options.waitForShellReady()
  await options.write({
    sessionId: options.sessionId,
    data: `${CLEAR_PROMPT_INPUT}${options.command}\r`,
  })
}
