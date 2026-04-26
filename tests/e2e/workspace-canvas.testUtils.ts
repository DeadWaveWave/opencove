import { accessSync, constants, existsSync, statfsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'path'

const E2E_PATH_DELETE_RETRY_MS = 500
const E2E_PATH_DELETE_MAX_ATTEMPTS = 40
const E2E_PARENT_DIR_NAME = 'opencove-e2e'
const E2E_USER_DATA_DIR_PREFIX = 'cove-e2e-user-data-'
const LINUX_CI_LARGE_TMP_DIR = '/mnt'

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

  const runnerTempDir = process.env['RUNNER_TEMP']?.trim()
  const candidates = [maybeResolveLargeLinuxTmpDir(), runnerTempDir, tmpdir()].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
  )

  let preferredDir = runnerTempDir || tmpdir()
  let preferredAvailableBytes = -1

  for (const candidate of new Set(candidates)) {
    const availableBytes = readAvailableBytes(candidate)
    if (availableBytes > preferredAvailableBytes) {
      preferredDir = candidate
      preferredAvailableBytes = availableBytes
    }
  }

  return preferredDir
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

  const parentDir = path.join(baseTmpDir, E2E_PARENT_DIR_NAME)
  await mkdir(parentDir, { recursive: true })
  return await mkdtemp(path.join(parentDir, E2E_USER_DATA_DIR_PREFIX))
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

function maybeResolveLargeLinuxTmpDir(): string | null {
  if (process.platform !== 'linux' || !isTruthyEnv(process.env['CI'])) {
    return null
  }

  if (!existsSync(LINUX_CI_LARGE_TMP_DIR)) {
    return null
  }

  try {
    accessSync(LINUX_CI_LARGE_TMP_DIR, constants.W_OK)
    return LINUX_CI_LARGE_TMP_DIR
  } catch {
    return null
  }
}

function readAvailableBytes(targetDir: string): number {
  try {
    accessSync(targetDir, constants.W_OK)
    const stats = statfsSync(targetDir)
    return Math.max(0, Number(stats.bavail) * Number(stats.bsize))
  } catch {
    return -1
  }
}
