import { accessSync, constants, existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'path'

const E2E_PATH_DELETE_RETRY_MS = 500
const E2E_PATH_DELETE_MAX_ATTEMPTS = 40

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

export function resolveE2ETmpDir(): string {
  const configuredTmpDir = process.env['OPENCOVE_E2E_TMPDIR']?.trim()
  if (configuredTmpDir) {
    return configuredTmpDir
  }

  if (process.platform === 'linux' && isTruthyEnv(process.env['CI']) && existsSync('/mnt')) {
    try {
      accessSync('/mnt', constants.W_OK)
      return '/mnt'
    } catch {
      // Fall through to RUNNER_TEMP/tmpdir when /mnt is not writable.
    }
  }

  const runnerTempDir = process.env['RUNNER_TEMP']?.trim()
  return runnerTempDir || tmpdir()
}

export async function delay(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function isRetryablePathCleanupError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY'
}

export async function createTestUserDataDir(): Promise<string> {
  const baseTmpDir = resolveE2ETmpDir()

  const parentDir = path.join(baseTmpDir, 'opencove-e2e')
  await mkdir(parentDir, { recursive: true })
  return await mkdtemp(path.join(parentDir, 'cove-e2e-user-data-'))
}

export async function removePathWithRetry(
  targetPath: string,
  attemptsRemaining = E2E_PATH_DELETE_MAX_ATTEMPTS,
): Promise<void> {
  try {
    await rm(targetPath, { recursive: true, force: true })
  } catch (error) {
    if (isRetryablePathCleanupError(error) && attemptsRemaining > 1) {
      await delay(E2E_PATH_DELETE_RETRY_MS)
      await removePathWithRetry(targetPath, attemptsRemaining - 1)
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`[e2e-cleanup] Failed to delete ${targetPath}: ${message}\n`)
  }
}

export function buildNodeEvalCommand(script: string): string {
  const encodedScript = Buffer.from(script, 'utf8').toString('base64')
  return `node -e "eval(Buffer.from('${encodedScript}','base64').toString())"`
}

export function buildEchoSequenceCommand(prefix: string, count: number): string {
  if (process.platform === 'win32') {
    return `1..${count} | ForEach-Object { Write-Output "${prefix}_$_" }`
  }

  return `for i in $(seq 1 ${count}); do echo ${prefix}_$i; done`
}

export function buildPaddedNumberSequenceCommand(count: number, width: number): string {
  if (process.platform === 'win32') {
    return `1..${count} | ForEach-Object { "{0:D${width}}" -f $_ }`
  }

  return `for i in $(seq 1 ${count}); do printf '%0${width}d\\n' $i; done`
}
