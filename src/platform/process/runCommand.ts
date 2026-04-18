import { spawn } from 'node:child_process'

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
    timeoutMs?: number
    stdin?: string
    env?: NodeJS.ProcessEnv
    windowsHide?: boolean
  } = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 30_000

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
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const finalize = (fn: () => void): void => {
      if (settled) {
        return
      }

      settled = true
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }

      fn()
    }

    timeoutHandle = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Ignore kill errors (process may already be gone).
      }

      finalize(() => {
        reject(new Error(`${command} command timed out`))
      })
    }, timeoutMs)

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
