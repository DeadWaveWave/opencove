import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { getAppErrorDebugMessage } from '../../../../shared/errors/appError'

const execFileAsync = promisify(execFile)

const DEFAULT_WRITER_LOCK_WAIT_MS = 1_500
const MAX_WRITER_LOCK_WAIT_MS = 5_000
const DEFAULT_WRITER_LOCK_POLL_MS = 100
const LSOF_TIMEOUT_MS = 500
const ACTIVE_WRITER_PATTERN = /(?:-32600\b|already has an active writer)/iu

export type CodexWriterLockProbeResult = 'available' | 'occupied' | 'unknown'
export type CodexWriterLockWaitResult = CodexWriterLockProbeResult | 'timed_out'

type Sleep = (delayMs: number) => Promise<void>

function delay(delayMs: number): Promise<void> {
  return new Promise(resolvePromise => {
    const timer = setTimeout(resolvePromise, Math.max(0, delayMs))
    timer.unref()
  })
}

function normalizeBoundedInteger(
  value: string | number | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }
  return Math.min(maximum, Math.floor(parsed))
}

export function resolveCodexWriterLockWaitMs(env: NodeJS.ProcessEnv = process.env): number {
  return normalizeBoundedInteger(
    env['OPENCOVE_CODEX_WRITER_LOCK_WAIT_MS'],
    DEFAULT_WRITER_LOCK_WAIT_MS,
    MAX_WRITER_LOCK_WAIT_MS,
  )
}

function resolveWriterLockPath(
  resumeSessionId: string,
  codexHome: string | undefined,
): string | null {
  const normalizedSessionId = resumeSessionId.trim()
  if (
    !codexHome ||
    normalizedSessionId.length === 0 ||
    normalizedSessionId.includes('/') ||
    normalizedSessionId.includes('\\') ||
    normalizedSessionId === '.' ||
    normalizedSessionId === '..'
  ) {
    return null
  }

  return resolve(codexHome, 'thread-writer-locks', `${normalizedSessionId}.lock`)
}

function isNoOpenFileResult(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 1
  )
}

export async function probeCodexWriterLock(options: {
  resumeSessionId: string
  codexHome?: string
  platform?: NodeJS.Platform
}): Promise<CodexWriterLockProbeResult> {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin' && platform !== 'linux') {
    return 'unknown'
  }

  const lockPath = resolveWriterLockPath(
    options.resumeSessionId,
    options.codexHome ?? process.env['CODEX_HOME'],
  )
  if (!lockPath || !existsSync(lockPath)) {
    return 'available'
  }

  try {
    const { stdout } = await execFileAsync('lsof', ['-t', '--', lockPath], {
      timeout: LSOF_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    })
    return stdout.trim().length > 0 ? 'occupied' : 'available'
  } catch (error) {
    return isNoOpenFileResult(error) ? 'available' : 'unknown'
  }
}

export async function waitForCodexWriterLockRelease(options: {
  resumeSessionId: string
  maxWaitMs?: number
  pollIntervalMs?: number
  probe?: (resumeSessionId: string) => Promise<CodexWriterLockProbeResult>
  sleep?: Sleep
  now?: () => number
}): Promise<CodexWriterLockWaitResult> {
  const maxWaitMs = normalizeBoundedInteger(
    options.maxWaitMs,
    resolveCodexWriterLockWaitMs(),
    MAX_WRITER_LOCK_WAIT_MS,
  )
  const pollIntervalMs = Math.max(
    1,
    normalizeBoundedInteger(
      options.pollIntervalMs,
      DEFAULT_WRITER_LOCK_POLL_MS,
      MAX_WRITER_LOCK_WAIT_MS,
    ),
  )
  const probe =
    options.probe ??
    (async (resumeSessionId: string) => await probeCodexWriterLock({ resumeSessionId }))
  const sleep = options.sleep ?? delay
  const now = options.now ?? Date.now
  const deadlineMs = now() + maxWaitMs

  const poll = async (): Promise<CodexWriterLockWaitResult> => {
    const observation = await probe(options.resumeSessionId)
    if (observation !== 'occupied') {
      return observation
    }

    const remainingMs = deadlineMs - now()
    if (remainingMs <= 0) {
      return 'timed_out'
    }

    await sleep(Math.min(pollIntervalMs, remainingMs))
    return await poll()
  }

  return await poll()
}

function describeError(error: unknown): string {
  const debugMessage = getAppErrorDebugMessage(
    error instanceof Error || typeof error === 'string' ? error : null,
  )
  if (debugMessage) {
    return debugMessage
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function isCodexActiveWriterError(error: unknown): boolean {
  return ACTIVE_WRITER_PATTERN.test(describeError(error))
}

export class CodexWriterLockRecoveryExhaustedError extends Error {
  public readonly cause: unknown

  public constructor(cause: unknown) {
    super(describeError(cause) || 'Codex writer lock remained occupied')
    this.name = 'CodexWriterLockRecoveryExhaustedError'
    this.cause = cause
  }
}

export async function runCodexResumeWithRetry<TResult>(options: {
  launch: () => Promise<TResult>
  maxAttempts: number
  backoffMs: readonly number[]
  sleep?: Sleep
}): Promise<TResult> {
  const maxAttempts = Math.max(1, Math.min(5, Math.floor(options.maxAttempts)))
  const sleep = options.sleep ?? delay

  const runAttempt = async (attempt: number): Promise<TResult> => {
    try {
      return await options.launch()
    } catch (error) {
      if (!isCodexActiveWriterError(error)) {
        throw error
      }
      if (attempt >= maxAttempts) {
        throw new CodexWriterLockRecoveryExhaustedError(error)
      }

      const configuredDelay = options.backoffMs[attempt - 1] ?? 0
      await sleep(Math.max(0, Math.min(MAX_WRITER_LOCK_WAIT_MS, configuredDelay)))
      return await runAttempt(attempt + 1)
    }
  }

  return await runAttempt(1)
}
