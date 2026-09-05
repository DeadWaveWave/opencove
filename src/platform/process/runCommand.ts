import { spawn } from 'node:child_process'
import { createCommandOutputCapture } from './boundedCommandOutput'

const DEFAULT_TIMEOUT_GRACE_MS = 1_000

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

function createAbortError(command: string): Error {
  const error = new Error(`${command} command aborted`)
  error.name = 'AbortError'
  return error
}

function normalizeCaptureMaxBytes(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('captureMaxBytes must be a non-negative safe integer or null.')
  }
  return value
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: {
    timeoutMs?: number | null
    timeoutGraceMs?: number
    stdin?: string
    env?: NodeJS.ProcessEnv
    windowsHide?: boolean
    signal?: AbortSignal
    onStdout?: (chunk: string) => void
    onStderr?: (chunk: string) => void
    captureMaxBytes?: number | null
  } = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs === undefined ? 30_000 : options.timeoutMs
  const timeoutGraceMs = options.timeoutGraceMs ?? DEFAULT_TIMEOUT_GRACE_MS
  const captureMaxBytes = normalizeCaptureMaxBytes(options.captureMaxBytes)
  if (options.signal?.aborted) {
    throw createAbortError(command)
  }

  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: options.windowsHide ?? true,
    })

    const stdout = createCommandOutputCapture(captureMaxBytes)
    const stderr = createCommandOutputCapture(captureMaxBytes)
    let settled = false
    let terminationReason: 'abort' | 'timeout' | null = null
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    let forceKillHandle: ReturnType<typeof setTimeout> | null = null

    const handleAbort = (): void => {
      beginTermination('abort')
    }

    const finalize = (fn: () => void): void => {
      if (settled) {
        return
      }

      settled = true
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle)
      }
      options.signal?.removeEventListener('abort', handleAbort)
      fn()
    }

    const killChild = (signal: NodeJS.Signals): void => {
      try {
        child.kill(signal)
      } catch {
        // Ignore kill errors (process may already be gone).
      }
    }

    const beginTermination = (reason: 'abort' | 'timeout'): void => {
      if (settled || terminationReason) {
        return
      }
      terminationReason = reason
      forceKillHandle = setTimeout(() => {
        killChild('SIGKILL')
      }, timeoutGraceMs)
      killChild('SIGTERM')
    }

    if (timeoutMs !== null) {
      timeoutHandle = setTimeout(() => {
        beginTermination('timeout')
      }, timeoutMs)
    }

    child.stdout.on('data', chunk => {
      const text = stdout.append(chunk)
      try {
        options.onStdout?.(text)
      } catch {
        // Observation cannot own process execution.
      }
    })

    child.stderr.on('data', chunk => {
      const text = stderr.append(chunk)
      try {
        options.onStderr?.(text)
      } catch {
        // Observation cannot own process execution.
      }
    })

    child.on('error', error => {
      if (terminationReason) {
        return
      }
      finalize(() => {
        reject(error)
      })
    })

    child.on('close', exitCode => {
      finalize(() => {
        if (terminationReason === 'timeout') {
          reject(new Error(`${command} command timed out`))
          return
        }
        if (terminationReason === 'abort') {
          reject(createAbortError(command))
          return
        }

        resolvePromise({
          exitCode: typeof exitCode === 'number' ? exitCode : 1,
          stdout: stdout.value(),
          stderr: stderr.value(),
        })
      })
    })

    // Install all completion observers before cancellation can synchronously close the child.
    options.signal?.addEventListener('abort', handleAbort, { once: true })
    if (options.signal?.aborted) {
      handleAbort()
    }

    if (!options.signal?.aborted) {
      const stdin = options.stdin
      if (typeof stdin === 'string' && stdin.length > 0) {
        child.stdin.write(stdin)
      }
      child.stdin.end()
    }
  })
}
