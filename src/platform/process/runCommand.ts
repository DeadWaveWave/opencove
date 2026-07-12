import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_GRACE_MS = 1_000

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
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
  } = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs === undefined ? 30_000 : options.timeoutMs
  const timeoutGraceMs = options.timeoutGraceMs ?? DEFAULT_TIMEOUT_GRACE_MS

  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: options.windowsHide ?? true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    let forceKillHandle: ReturnType<typeof setTimeout> | null = null

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

      fn()
    }

    const killChild = (signal: NodeJS.Signals): void => {
      try {
        child.kill(signal)
      } catch {
        // Ignore kill errors (process may already be gone).
      }
    }

    if (timeoutMs !== null) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        forceKillHandle = setTimeout(() => {
          killChild('SIGKILL')
        }, timeoutGraceMs)
        killChild('SIGTERM')
      }, timeoutMs)
    }

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', error => {
      finalize(() => {
        reject(error)
      })
    })

    child.on('close', exitCode => {
      finalize(() => {
        if (timedOut) {
          reject(new Error(`${command} command timed out`))
          return
        }

        resolvePromise({
          exitCode: typeof exitCode === 'number' ? exitCode : 1,
          stdout,
          stderr,
        })
      })
    })

    const stdin = options.stdin
    if (typeof stdin === 'string' && stdin.length > 0) {
      child.stdin.write(stdin)
    }
    child.stdin.end()
  })
}
