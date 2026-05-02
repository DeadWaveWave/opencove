import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import type { ExecutableResolutionSource } from '@shared/contracts/dto'
import {
  getShellEnvironmentSnapshot,
  type ShellEnvironmentSnapshot,
} from '../os/ShellEnvironmentService'

export type ExecutableResolutionStatus = 'resolved' | 'not_found' | 'invalid_override'

export interface ExecutableLocationRequest {
  toolId: string
  command: string
  overridePath?: string | null
  fallbackDirectories?: string[]
}

export interface ExecutableLocationResult {
  toolId: string
  command: string
  executablePath: string | null
  source: ExecutableResolutionSource | null
  status: ExecutableResolutionStatus
  diagnostics: string[]
}

const WINDOWS_DEFAULT_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd']

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveTargetPathApi(): typeof path.posix | typeof path.win32 {
  return process.platform === 'win32' ? path.win32 : path.posix
}

function dedupeStrings(values: readonly string[]): string[] {
  const unique: string[] = []

  for (const value of values) {
    if (value.length === 0 || unique.includes(value)) {
      continue
    }

    unique.push(value)
  }

  return unique
}

function isPathLikeCommand(command: string): boolean {
  return (
    command.includes('/') || command.includes('\\') || resolveTargetPathApi().isAbsolute(command)
  )
}

function splitPathValue(pathValue: string): string[] {
  const { delimiter } = resolveTargetPathApi()
  return pathValue
    .split(delimiter)
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
}

function resolveWindowsCandidateNames(command: string): string[] {
  const { extname } = resolveTargetPathApi()
  if (process.platform !== 'win32') {
    return [command]
  }

  if (extname(command).length > 0) {
    return [command]
  }

  const pathExt =
    process.env.PATHEXT?.split(';')
      .map(value => value.trim().toLowerCase())
      .filter(value => value.length > 0) ?? WINDOWS_DEFAULT_EXTENSIONS

  return dedupeStrings([...pathExt.map(extension => `${command}${extension}`), command])
}

async function isUsableExecutable(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) {
      return false
    }

    if (process.platform === 'win32') {
      return true
    }

    const mode = stats.mode & 0o111
    return mode !== 0
  } catch {
    return false
  }
}

async function resolveDirectPath(command: string): Promise<string | null> {
  const { isAbsolute, resolve } = resolveTargetPathApi()
  const candidateNames = resolveWindowsCandidateNames(command)

  for (const candidateName of candidateNames) {
    const resolvedPath = isAbsolute(candidateName) ? candidateName : resolve(candidateName)
    // eslint-disable-next-line no-await-in-loop -- ordered Windows extension resolution is required
    if (await isUsableExecutable(resolvedPath)) {
      return resolvedPath
    }
  }

  return null
}

async function searchPathDirectories(
  command: string,
  directories: readonly string[],
): Promise<string | null> {
  const { join } = resolveTargetPathApi()
  if (directories.length === 0) {
    return null
  }

  const candidateNames = resolveWindowsCandidateNames(command)
  const candidatePaths = directories.flatMap(directory =>
    candidateNames.map(candidateName => join(directory, candidateName)),
  )
  const checks = await Promise.all(
    candidatePaths.map(async candidatePath => ({
      candidatePath,
      isExecutable: await isUsableExecutable(candidatePath),
    })),
  )

  return checks.find(check => check.isExecutable)?.candidatePath ?? null
}

async function resolveOverridePath(overridePath: string): Promise<string | null> {
  if (isPathLikeCommand(overridePath)) {
    return await resolveDirectPath(overridePath)
  }

  return await searchPathDirectories(overridePath, splitPathValue(process.env.PATH ?? ''))
}

async function resolveExecutableFromSnapshot(
  command: string,
  snapshot: ShellEnvironmentSnapshot,
): Promise<string | null> {
  if (isPathLikeCommand(command)) {
    return await resolveDirectPath(command)
  }

  return await searchPathDirectories(command, splitPathValue(snapshot.env.PATH ?? ''))
}

export async function locateExecutable(
  request: ExecutableLocationRequest,
): Promise<ExecutableLocationResult> {
  const command = normalizeText(request.command)
  const overridePath = normalizeText(request.overridePath)
  const diagnostics: string[] = []

  if (command.length === 0) {
    diagnostics.push(`No command was configured for ${request.toolId}.`)
    return {
      toolId: request.toolId,
      command,
      executablePath: null,
      source: null,
      status: 'not_found',
      diagnostics,
    }
  }

  if (overridePath.length > 0) {
    const resolvedOverride = await resolveOverridePath(overridePath)
    if (resolvedOverride) {
      diagnostics.push(`Resolved ${request.toolId} from explicit override.`)
      return {
        toolId: request.toolId,
        command,
        executablePath: resolvedOverride,
        source: 'override',
        status: 'resolved',
        diagnostics,
      }
    }

    diagnostics.push(`Configured override was not executable: ${overridePath}`)
    return {
      toolId: request.toolId,
      command,
      executablePath: null,
      source: null,
      status: 'invalid_override',
      diagnostics,
    }
  }

  const shellSnapshot = await getShellEnvironmentSnapshot()
  diagnostics.push(...shellSnapshot.diagnostics)

  const fromShellPath = await resolveExecutableFromSnapshot(command, shellSnapshot)
  if (fromShellPath) {
    diagnostics.push(`Resolved ${request.toolId} from shell-derived PATH.`)
    return {
      toolId: request.toolId,
      command,
      executablePath: fromShellPath,
      source: 'shell_env_path',
      status: 'resolved',
      diagnostics,
    }
  }

  const processPathSnapshot: ShellEnvironmentSnapshot = {
    env: { ...process.env },
    shellPath: null,
    source: 'process_env',
    diagnostics: [],
  }

  const fromProcessPath = await resolveExecutableFromSnapshot(command, processPathSnapshot)
  if (fromProcessPath) {
    diagnostics.push(`Resolved ${request.toolId} from current process PATH.`)
    return {
      toolId: request.toolId,
      command,
      executablePath: fromProcessPath,
      source: 'process_path',
      status: 'resolved',
      diagnostics,
    }
  }

  const fallbackDirectories = dedupeStrings(
    (request.fallbackDirectories ?? []).map(directory => directory.trim()).filter(Boolean),
  )

  const fromFallbackDirectory = await searchPathDirectories(command, fallbackDirectories)
  if (fromFallbackDirectory) {
    diagnostics.push(`Resolved ${request.toolId} from fallback executable directories.`)
    return {
      toolId: request.toolId,
      command,
      executablePath: fromFallbackDirectory,
      source: 'fallback_directory',
      status: 'resolved',
      diagnostics,
    }
  }

  diagnostics.push(
    `Unable to resolve ${request.toolId} (${command}) from shell PATH, process PATH, or fallback directories.`,
  )
  return {
    toolId: request.toolId,
    command,
    executablePath: null,
    source: null,
    status: 'not_found',
    diagnostics,
  }
}
