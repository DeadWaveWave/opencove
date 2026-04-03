import { app } from 'electron'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { CliPathStatusResult } from '../../../shared/contracts/dto'
import { createAppError } from '../../../shared/errors/appError'

const CLI_WRAPPER_MARKER = '__OPENCOVE_CLI_WRAPPER__'
const CLI_WRAPPER_NAME = 'opencove'

function quoteSh(value: string): string {
  // Wrap the value in a single-quoted shell string.
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function resolveUserBinDir(): string {
  return join(app.getPath('home'), '.local', 'bin')
}

async function canWriteDirectory(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

function resolveSystemBinDirs(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') {
    return ['/opt/homebrew/bin', '/usr/local/bin']
  }

  if (platform === 'linux') {
    return ['/usr/local/bin']
  }

  return []
}

function resolveCliScriptPath(): string {
  return resolve(app.getAppPath(), 'src', 'app', 'cli', 'opencove.mjs')
}

function buildWrapperScript(executablePath: string, cliScriptPath: string): string {
  return `#!/bin/sh
# ${CLI_WRAPPER_MARKER}

ELECTRON_BIN=${quoteSh(executablePath)}
CLI_SCRIPT=${quoteSh(cliScriptPath)}

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "[opencove] OpenCove executable not found: $ELECTRON_BIN" >&2
  exit 1
fi

if [ ! -f "$CLI_SCRIPT" ]; then
  echo "[opencove] CLI entry not found: $CLI_SCRIPT" >&2
  exit 1
fi

ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" "$CLI_SCRIPT" "$@"
`
}

async function readWrapperIfOwned(targetPath: string): Promise<string | null> {
  try {
    const raw = await readFile(targetPath, 'utf8')
    return raw.includes(CLI_WRAPPER_MARKER) ? raw : null
  } catch {
    return null
  }
}

function resolveInstallCandidates(platform: NodeJS.Platform): string[] {
  const candidates: string[] = []
  for (const dirPath of resolveSystemBinDirs(platform)) {
    candidates.push(join(dirPath, CLI_WRAPPER_NAME))
  }
  const userBin = resolveUserBinDir()
  candidates.push(join(userBin, CLI_WRAPPER_NAME))

  return candidates
}

export async function resolveCliPathStatus(): Promise<CliPathStatusResult> {
  const candidates = resolveInstallCandidates(process.platform)
  const ownedCandidates = await Promise.all(
    candidates.map(async candidate => await readWrapperIfOwned(candidate)),
  )

  for (let index = 0; index < candidates.length; index += 1) {
    if (ownedCandidates[index]) {
      return { installed: true, path: candidates[index] }
    }
  }

  return { installed: false, path: null }
}

async function resolveWritableInstallTarget(): Promise<string> {
  const candidates = resolveInstallCandidates(process.platform)
  const userBinDir = resolveUserBinDir()

  const [ownedCandidates, existsCandidates, writableDirCandidates] = await Promise.all([
    Promise.all(candidates.map(async candidate => await readWrapperIfOwned(candidate))),
    Promise.all(
      candidates.map(async candidate => {
        try {
          await access(candidate, fsConstants.F_OK)
          return true
        } catch {
          return false
        }
      }),
    ),
    Promise.all(
      candidates.map(async candidate => {
        const dirPath = dirname(candidate)
        if (dirPath === userBinDir) {
          return true
        }

        return await canWriteDirectory(dirPath)
      }),
    ),
  ])

  for (let index = 0; index < candidates.length; index += 1) {
    if (ownedCandidates[index]) {
      return candidates[index]
    }
  }

  let selectedIndex: number | null = null
  for (let index = 0; index < candidates.length; index += 1) {
    if (existsCandidates[index]) {
      continue
    }

    if (!writableDirCandidates[index]) {
      continue
    }

    selectedIndex = index
    break
  }

  if (selectedIndex !== null) {
    const targetPath = candidates[selectedIndex]
    if (dirname(targetPath) === userBinDir) {
      await mkdir(userBinDir, { recursive: true })
    }

    return targetPath
  }

  throw createAppError('common.unavailable', {
    debugMessage: 'No writable CLI install target found.',
  })
}

export async function installCliToPath(): Promise<CliPathStatusResult> {
  if (process.platform === 'win32') {
    throw createAppError('common.unavailable', {
      debugMessage: 'CLI install is not supported on Windows yet.',
    })
  }

  const targetPath = await resolveWritableInstallTarget()
  const cliScriptPath = resolveCliScriptPath()

  try {
    await access(cliScriptPath, fsConstants.F_OK)
  } catch {
    throw createAppError('common.unavailable', {
      debugMessage: `CLI entry is missing: ${cliScriptPath}`,
    })
  }

  const script = buildWrapperScript(process.execPath, cliScriptPath)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, script, { encoding: 'utf8', mode: 0o755 })

  return { installed: true, path: targetPath }
}

export async function uninstallCliFromPath(): Promise<CliPathStatusResult> {
  const status = await resolveCliPathStatus()
  if (!status.installed || !status.path) {
    return { installed: false, path: null }
  }

  await rm(status.path, { force: true })
  return { installed: false, path: null }
}
