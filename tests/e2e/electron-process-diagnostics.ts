import type { ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUTPUT_LIMIT_BYTES = 256 * 1024
const processFailurePattern = /"event":"(?:render-process-gone|child-process-gone)"/u

export function captureElectronProcessDiagnostics(
  child: ChildProcess,
  userDataDir: string,
  pipeLogs: boolean,
) {
  let stdout: Buffer = Buffer.alloc(0)
  let stderr: Buffer = Buffer.alloc(0)
  let truncated = false
  let runtimeLog = ''
  let finished: Promise<void> | undefined
  const retain = (previous: Buffer, chunk: Buffer): Buffer => {
    const combined = Buffer.concat([previous, chunk])
    truncated ||= combined.length > OUTPUT_LIMIT_BYTES
    return Buffer.from(combined.subarray(-OUTPUT_LIMIT_BYTES))
  }
  const onStdout = (chunk: Buffer): void => {
    stdout = retain(stdout, chunk)
    if (pipeLogs) {
      process.stdout.write(chunk)
    }
  }
  const onStderr = (chunk: Buffer): void => {
    stderr = retain(stderr, chunk)
    if (pipeLogs) {
      process.stderr.write(chunk)
    }
  }
  child.stdout?.on('data', onStdout)
  child.stderr?.on('data', onStderr)

  const text = (): string =>
    [
      `Electron pid=${child.pid} exitCode=${child.exitCode} signal=${child.signalCode}`,
      ...(truncated ? ['Process output truncated to the last 256 KiB per stream.'] : []),
      '[stdout]',
      stdout.toString(),
      '[stderr]',
      stderr.toString(),
      '[runtime diagnostics, including startup before Playwright connected]',
      runtimeLog,
    ].join('\n')

  const finish = async (): Promise<void> => {
    finished ??= (async () => {
      // Read before launchApp removes userData. The rotated file retains early startup failures.
      runtimeLog = (
        await Promise.all(
          ['runtime-diagnostics.log.1', 'runtime-diagnostics.log'].map(async name => {
            try {
              return await readFile(join(userDataDir, 'logs', name), 'utf8')
            } catch (error) {
              return `${name}: unavailable (${(error as NodeJS.ErrnoException).code ?? 'unknown'})`
            }
          }),
        )
      ).join('\n')
      child.stdout?.removeListener('data', onStdout)
      child.stderr?.removeListener('data', onStderr)
      if (!pipeLogs) {
        const records = new Set(
          text()
            .split('\n')
            .filter(line => processFailurePattern.test(line))
            .map(line => line.slice(line.indexOf('{'))),
        )
        for (const record of records) {
          process.stderr.write(
            `[e2e electron pid=${child.pid}] [opencove-runtime-diagnostics] ${record}\n`,
          )
        }
      }
    })()
    await finished
  }

  return { finish, text, hasProcessFailure: () => processFailurePattern.test(text()) }
}
