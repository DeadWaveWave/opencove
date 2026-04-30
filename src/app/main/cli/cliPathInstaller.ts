import { app } from 'electron'
import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { CliPathStatusResult } from '../../../shared/contracts/dto'
import { createAppError } from '../../../shared/errors/appError'
import { resolvePackagedCliScriptPath } from '../runtime/opencoveRuntimePaths'

const CLI_WRAPPER_MARKER = '__OPENCOVE_CLI_WRAPPER__'
const CLI_WRAPPER_NAME = 'opencove'
const CLI_WRAPPER_KIND_KEY = 'OPENCOVE_WRAPPER_KIND'
const CLI_WRAPPER_ELECTRON_BIN_KEY = 'OPENCOVE_ELECTRON_BIN'
const CLI_WRAPPER_CLI_SCRIPT_KEY = 'OPENCOVE_CLI_SCRIPT'

const execFileAsync = promisify(execFile)

function quoteSh(value: string): string {
  // Wrap the value in a single-quoted shell string.
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function quoteCmdSetValue(value: string): string {
  return value.replace(/%/g, '%%')
}

function resolveWindowsLocalAppDataDir(): string {
  const normalized = process.env.LOCALAPPDATA?.trim()
  if (normalized) {
    return normalized
  }

  return join(app.getPath('home'), 'AppData', 'Local')
}

function resolveUserBinDir(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return join(resolveWindowsLocalAppDataDir(), 'OpenCove', 'bin')
  }

  return join(app.getPath('home'), '.local', 'bin')
}

function resolveCliWrapperName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${CLI_WRAPPER_NAME}.cmd` : CLI_WRAPPER_NAME
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
  if (app.isPackaged) {
    return resolvePackagedCliScriptPath(process.resourcesPath)
  }

  return resolve(app.getAppPath(), 'src', 'app', 'cli', 'opencove.mjs')
}

function buildWrapperScript(executablePath: string, cliScriptPath: string): string {
  return `#!/bin/sh
# ${CLI_WRAPPER_MARKER}
# OPENCOVE_WRAPPER_KIND=runtime
# OPENCOVE_ELECTRON_BIN=${executablePath}
# OPENCOVE_CLI_SCRIPT=${cliScriptPath}

ELECTRON_BIN=${quoteSh(executablePath)}
CLI_SCRIPT=${quoteSh(cliScriptPath)}

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "[opencove] OpenCove executable not found: $ELECTRON_BIN" >&2
  exit 1
fi

case "$CLI_SCRIPT" in
  *.asar/*) ;;
  *)
    if [ ! -f "$CLI_SCRIPT" ]; then
      echo "[opencove] CLI entry not found: $CLI_SCRIPT" >&2
      exit 1
    fi
    ;;
esac

ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" "$CLI_SCRIPT" "$@"
`
}

function buildWindowsWrapperScript(executablePath: string, cliScriptPath: string): string {
  const escapedExecutablePath = quoteCmdSetValue(executablePath)
  const escapedCliScriptPath = quoteCmdSetValue(cliScriptPath)

  return `@echo off
rem ${CLI_WRAPPER_MARKER}
rem OPENCOVE_WRAPPER_KIND=runtime
rem OPENCOVE_ELECTRON_BIN=${escapedExecutablePath}
rem OPENCOVE_CLI_SCRIPT=${escapedCliScriptPath}

set "ELECTRON_BIN=${escapedExecutablePath}"
set "CLI_SCRIPT=${escapedCliScriptPath}"

if not exist "%ELECTRON_BIN%" (
  echo [opencove] OpenCove executable not found: %ELECTRON_BIN% 1>&2
  exit /b 1
)

echo "%CLI_SCRIPT%" | findstr /i /c:".asar\\" /c:".asar/" >nul
if errorlevel 1 (
  if not exist "%CLI_SCRIPT%" (
    echo [opencove] CLI entry not found: %CLI_SCRIPT% 1>&2
    exit /b 1
  )
)

set "ELECTRON_RUN_AS_NODE=1"
"%ELECTRON_BIN%" "%CLI_SCRIPT%" %*
exit /b %ERRORLEVEL%
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

function readMetadataValue(wrapper: string, key: string): string | null {
  const prefix = `${key}=`
  const line = wrapper
    .split(/\r\n|\r|\n/)
    .map(candidate => candidate.trim().replace(/^(?:#|@?rem|::)\s*/i, ''))
    .find(candidate => candidate.startsWith(prefix))
    ?.slice(prefix.length)
    .trim()

  return line && line.length > 0 ? line : null
}

async function isWrapperHealthy(wrapper: string): Promise<boolean> {
  const kind = readMetadataValue(wrapper, CLI_WRAPPER_KIND_KEY)
  const electronBin = readMetadataValue(wrapper, CLI_WRAPPER_ELECTRON_BIN_KEY)
  const cliScript = readMetadataValue(wrapper, CLI_WRAPPER_CLI_SCRIPT_KEY)

  if (kind !== 'runtime' || !electronBin || !cliScript) {
    return false
  }

  try {
    await access(electronBin, fsConstants.X_OK)
    await access(cliScript, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function resolveInstallCandidates(platform: NodeJS.Platform): string[] {
  const candidates: string[] = []
  const wrapperName = resolveCliWrapperName(platform)
  for (const dirPath of resolveSystemBinDirs(platform)) {
    candidates.push(join(dirPath, wrapperName))
  }
  const userBin = resolveUserBinDir(platform)
  candidates.push(join(userBin, wrapperName))

  return candidates
}

function splitPathSegments(pathValue: string): string[] {
  return pathValue
    .split(';')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
}

function normalizeWindowsPathSegment(value: string): string {
  return value.replace(/[\\/]+$/g, '').toLowerCase()
}

function pathSegmentsContain(segments: string[], targetPath: string): boolean {
  const normalizedTarget = normalizeWindowsPathSegment(targetPath)
  return segments.some(segment => normalizeWindowsPathSegment(segment) === normalizedTarget)
}

function resolveWindowsPowerShellCommand(): string {
  const systemRoot = process.env.SystemRoot?.trim()
  if (systemRoot) {
    return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  }

  return 'powershell.exe'
}

async function updateWindowsUserPath(targetPath: string, action: 'add' | 'remove'): Promise<void> {
  const script = `
$ErrorActionPreference = 'Stop'
$target = $args[0]
$action = $args[1]
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $current) { $current = '' }
$segments = @($current -split ';' | Where-Object { $_.Trim().Length -gt 0 })
$normalizedTarget = $target.TrimEnd('\\', '/').ToLowerInvariant()
$nextSegments = @()
foreach ($segment in $segments) {
  if ($segment.TrimEnd('\\', '/').ToLowerInvariant() -ne $normalizedTarget) {
    $nextSegments += $segment
  }
}
if ($action -eq 'add') {
  $nextSegments += $target
}
[Environment]::SetEnvironmentVariable('Path', ($nextSegments -join ';'), 'User')
`
  await execFileAsync(resolveWindowsPowerShellCommand(), [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
    targetPath,
    action,
  ])
}

async function ensureWindowsUserPathIncludes(dirPath: string): Promise<void> {
  const currentSegments = splitPathSegments(process.env.PATH ?? '')
  if (!pathSegmentsContain(currentSegments, dirPath)) {
    process.env.PATH = [...currentSegments, dirPath].join(';')
  }

  await updateWindowsUserPath(dirPath, 'add')
}

async function removeWindowsUserPathEntry(dirPath: string): Promise<void> {
  const currentSegments = splitPathSegments(process.env.PATH ?? '').filter(
    segment => normalizeWindowsPathSegment(segment) !== normalizeWindowsPathSegment(dirPath),
  )
  process.env.PATH = currentSegments.join(';')

  await updateWindowsUserPath(dirPath, 'remove')
}

export async function resolveCliPathStatus(): Promise<CliPathStatusResult> {
  const candidates = resolveInstallCandidates(process.platform)
  const ownedCandidates = await Promise.all(
    candidates.map(async candidate => {
      const wrapper = await readWrapperIfOwned(candidate)
      return wrapper ? { wrapper, healthy: await isWrapperHealthy(wrapper) } : null
    }),
  )

  for (let index = 0; index < candidates.length; index += 1) {
    const ownedCandidate = ownedCandidates[index]
    if (ownedCandidate) {
      return {
        installed: true,
        path: candidates[index],
        healthy: ownedCandidate.healthy,
      }
    }
  }

  return { installed: false, path: null, healthy: false }
}

async function resolveWritableInstallTarget(): Promise<string> {
  const candidates = resolveInstallCandidates(process.platform)
  const userBinDir = resolveUserBinDir(process.platform)

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
  const targetPath = await resolveWritableInstallTarget()
  const cliScriptPath = resolveCliScriptPath()

  try {
    await access(cliScriptPath, fsConstants.F_OK)
  } catch {
    throw createAppError('common.unavailable', {
      debugMessage: `CLI entry is missing: ${cliScriptPath}`,
    })
  }

  const script =
    process.platform === 'win32'
      ? buildWindowsWrapperScript(process.execPath, cliScriptPath)
      : buildWrapperScript(process.execPath, cliScriptPath)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, script, { encoding: 'utf8', mode: 0o755 })
  if (process.platform === 'win32') {
    await ensureWindowsUserPathIncludes(dirname(targetPath))
  }

  return { installed: true, path: targetPath, healthy: true }
}

export async function uninstallCliFromPath(): Promise<CliPathStatusResult> {
  const status = await resolveCliPathStatus()
  if (!status.installed || !status.path) {
    return { installed: false, path: null, healthy: false }
  }

  await rm(status.path, { force: true })
  if (process.platform === 'win32') {
    await removeWindowsUserPathEntry(dirname(status.path))
  }
  return { installed: false, path: null, healthy: false }
}
