import type {
  AgentProviderId,
  TerminalAgentActivityFence,
  TerminalForegroundEvent,
  TerminalSessionMetadataEvent,
} from '../../../shared/contracts/dto'
import { TERMINAL_AGENT_DROP_BACK_TIMEOUT_MS } from '../../../shared/runtime/terminalAgentReexec'

const INTERRUPT_FOREGROUND_JOB = '\u0003'
const CLEAR_PROMPT_INPUT = '\u0015'
const PROBE_SHELL_PROMPT = `${CLEAR_PROMPT_INPUT}cd .\r`

export type TerminalAgentPtyReexecResult =
  | 'reexecuted'
  | 'drop_back_timeout'
  | 'rejected_stale_activity'
  | 'session_not_found'
  | 'runtime_failed'

export interface TerminalAgentPtyReexecRuntime {
  write: (sessionId: string, data: string) => void | Promise<void>
  probeForeground?: (sessionId: string) => void
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  onForeground?: (listener: (event: TerminalForegroundEvent) => void) => () => void
  onMetadata?: (listener: (event: TerminalSessionMetadataEvent) => void) => () => void
}

function assertSafeSessionId(sessionId: string): string {
  const normalized = sessionId.trim()
  if (!/^[A-Za-z0-9._:@/+\-=]+$/.test(normalized)) {
    throw new Error('Agent session id contains unsupported shell characters.')
  }
  return normalized
}

export function buildTerminalAgentReentryCommand(options: {
  provider: AgentProviderId
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

function confirmsShellPrompt(
  event: TerminalForegroundEvent,
  notBeforeMs: number,
  allowWeakWindowsFallback: boolean,
): boolean {
  if (event.observedAtMs < notBeforeMs) {
    return false
  }
  if (event.source === 'windows_exit_code') {
    return true
  }
  if (event.source === 'windows_prompt_timeout') {
    return allowWeakWindowsFallback
  }
  return event.availability === 'available' && event.agent === null && event.shellOnly
}

function classifyActivityEvent(
  event: TerminalSessionMetadataEvent,
  expected: TerminalAgentActivityFence | null,
): 'ignore' | 'exited' | 'stale' {
  const activity = event.terminalAgentActivity
  if (!activity) {
    return 'ignore'
  }
  if (!expected) {
    return 'stale'
  }
  if (activity.generation < expected.generation) {
    return 'ignore'
  }
  if (
    activity.generation !== expected.generation ||
    activity.provider !== expected.provider ||
    activity.invocationId !== expected.invocationId
  ) {
    return 'stale'
  }
  return activity.phase === 'exited' ? 'exited' : 'ignore'
}

export async function reexecTerminalAgentInPty(options: {
  sessionId: string
  provider: AgentProviderId
  resumeSessionId: string | null
  expectedActivity: TerminalAgentActivityFence | null
  runtime: TerminalAgentPtyReexecRuntime
  timeoutMs?: number
  now?: () => number
}): Promise<TerminalAgentPtyReexecResult> {
  const command = buildTerminalAgentReentryCommand(options)
  if (!options.runtime.onForeground || (options.expectedActivity && !options.runtime.onMetadata)) {
    return 'runtime_failed'
  }

  const operationStartedAtMs = (options.now ?? Date.now)()
  const timeoutMs = options.timeoutMs ?? TERMINAL_AGENT_DROP_BACK_TIMEOUT_MS
  const expectedAlreadyExited = options.expectedActivity?.phase === 'exited'
  return await new Promise<TerminalAgentPtyReexecResult>(resolve => {
    let activityExited = options.expectedActivity === null || expectedAlreadyExited
    let shellPromptConfirmed = false
    let settled = false
    let committing = false
    let timer: NodeJS.Timeout | null = null
    let foregroundProbeTimer: NodeJS.Timeout | null = null
    const disposers: Array<() => void> = []

    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (foregroundProbeTimer) {
        clearInterval(foregroundProbeTimer)
        foregroundProbeTimer = null
      }
      disposers.splice(0).forEach(dispose => dispose())
    }
    const finish = (result: TerminalAgentPtyReexecResult): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(result)
    }
    const requestForegroundProbe = (): boolean => {
      try {
        options.runtime.probeForeground?.(options.sessionId)
        return true
      } catch {
        finish('runtime_failed')
        return false
      }
    }
    const commitCommandIfReady = (): void => {
      if (settled || committing || !activityExited || !shellPromptConfirmed) {
        return
      }
      committing = true
      cleanup()
      void Promise.resolve()
        .then(() => options.runtime.write(options.sessionId, `${CLEAR_PROMPT_INPUT}${command}\r`))
        .then(
          () => finish('reexecuted'),
          () => finish('runtime_failed'),
        )
    }

    disposers.push(
      options.runtime.onExit(event => {
        if (event.sessionId === options.sessionId) {
          finish('session_not_found')
        }
      }),
    )
    disposers.push(
      options.runtime.onForeground!(event => {
        if (
          event.sessionId === options.sessionId &&
          confirmsShellPrompt(event, operationStartedAtMs, options.expectedActivity !== null)
        ) {
          shellPromptConfirmed = true
          commitCommandIfReady()
        }
      }),
    )
    if (options.runtime.onMetadata) {
      disposers.push(
        options.runtime.onMetadata(event => {
          if (event.sessionId !== options.sessionId) {
            return
          }
          const classification = classifyActivityEvent(event, options.expectedActivity)
          if (classification === 'stale') {
            finish('rejected_stale_activity')
          } else if (classification === 'exited') {
            activityExited = true
            commitCommandIfReady()
          }
        }),
      )
    }
    timer = setTimeout(() => finish('drop_back_timeout'), timeoutMs)
    commitCommandIfReady()

    void Promise.resolve()
      .then(() =>
        options.runtime.write(
          options.sessionId,
          expectedAlreadyExited ? PROBE_SHELL_PROMPT : INTERRUPT_FOREGROUND_JOB,
        ),
      )
      .then(() => {
        if (settled || !options.runtime.probeForeground) {
          return
        }
        if (!requestForegroundProbe() || settled || committing) {
          return
        }
        foregroundProbeTimer = setInterval(() => {
          requestForegroundProbe()
        }, 250)
        foregroundProbeTimer.unref?.()
      })
      .catch(() => finish('runtime_failed'))
  })
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
