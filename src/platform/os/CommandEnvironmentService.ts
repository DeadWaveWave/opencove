import process from 'node:process'
import {
  getShellEnvironmentSnapshot,
  sanitizeCapturedShellEnvironment,
  type ShellEnvironmentSnapshot,
} from './ShellEnvironmentService'
import { removeElectronRunAsNode } from './ElectronControlEnvironment'
import { mergeCommandPath, splitPathSegments } from './CommandPathSegments'
import { resolveHomeDirectory } from './HomeDirectory'

const TRUST_PROCESS_ENV_MARKER = 'OPENCOVE_TRUST_PROCESS_ENV'

export type CommandEnvironmentSource = 'process_env' | 'shell_env'

export interface CommandEnvironmentSnapshot {
  env: NodeJS.ProcessEnv
  shellPath: string | null
  source: CommandEnvironmentSource
  diagnostics: string[]
}

let cachedCommandEnvironmentPromise: Promise<CommandEnvironmentSnapshot> | null = null

function cloneSnapshot(snapshot: CommandEnvironmentSnapshot): CommandEnvironmentSnapshot {
  return {
    env: { ...snapshot.env },
    shellPath: snapshot.shellPath,
    source: snapshot.source,
    diagnostics: [...snapshot.diagnostics],
  }
}

function normalizeTruthyEnv(value: string | undefined): boolean {
  if (typeof value !== 'string') {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function resolveProcessEnvironmentReason(): string | null {
  if (process.platform === 'win32') {
    return 'Windows uses the current process environment for command execution.'
  }

  if (process.env.NODE_ENV === 'test') {
    return 'Test mode uses the current process environment for command execution.'
  }

  if (normalizeTruthyEnv(process.env[TRUST_PROCESS_ENV_MARKER])) {
    return 'Launch marker requested the current process environment for command execution.'
  }

  return null
}

function normalizeProcessCommandEnvironment(env: NodeJS.ProcessEnv): {
  env: NodeJS.ProcessEnv
  diagnostics: string[]
} {
  const nextEnv = removeElectronRunAsNode(env)
  if (process.platform !== 'win32') {
    return {
      env: nextEnv,
      diagnostics: [],
    }
  }

  const currentPathKey = findWindowsPathEnvKey(nextEnv)
  const currentPath = currentPathKey ? (nextEnv[currentPathKey] ?? '') : ''
  const normalizedPath = mergeCommandPath({
    platform: process.platform,
    currentPath,
    homeDir: resolveHomeDirectory(),
    env: nextEnv,
  })
  const needsCanonicalPathKey = currentPathKey !== null && currentPathKey !== 'PATH'
  if (normalizedPath === currentPath && !needsCanonicalPathKey) {
    return {
      env: nextEnv,
      diagnostics: [],
    }
  }

  writeCanonicalWindowsPathEnvValue(nextEnv, normalizedPath)
  const diagnostics: string[] = []
  if (normalizedPath !== currentPath) {
    diagnostics.push(
      'Appended stable Windows command fallback directories to the current process PATH.',
    )
  }
  if (needsCanonicalPathKey) {
    diagnostics.push('Canonicalized Windows process Path key to PATH.')
  }
  return {
    env: nextEnv,
    diagnostics,
  }
}

function findWindowsPathEnvKey(env: NodeJS.ProcessEnv): string | null {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
  return pathKey ?? null
}

function writeCanonicalWindowsPathEnvValue(env: NodeJS.ProcessEnv, value: string): void {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path' && key !== 'PATH') {
      delete env[key]
    }
  }

  env.PATH = value
}

function mergeExplicitCommandPath(
  basePath: string | undefined,
  explicitPath: string | undefined,
): string | undefined {
  if (typeof explicitPath !== 'string' || explicitPath.trim().length === 0) {
    return basePath
  }

  if (typeof basePath !== 'string' || basePath.trim().length === 0) {
    return explicitPath
  }

  const delimiter = process.platform === 'win32' ? ';' : ':'
  return [
    ...splitPathSegments(explicitPath, delimiter),
    ...splitPathSegments(basePath, delimiter),
  ].join(delimiter)
}

function toCommandEnvironmentSnapshot(
  shellSnapshot: ShellEnvironmentSnapshot,
): CommandEnvironmentSnapshot {
  const source = shellSnapshot.source === 'process_env' ? 'process_env' : 'shell_env'
  const normalizedProcessEnvironment =
    source === 'process_env' ? normalizeProcessCommandEnvironment(shellSnapshot.env) : null
  const env =
    source === 'shell_env'
      ? sanitizeCapturedShellEnvironment(shellSnapshot.env)
      : normalizedProcessEnvironment!.env
  return {
    env,
    shellPath: shellSnapshot.shellPath,
    source,
    diagnostics: [
      ...shellSnapshot.diagnostics,
      ...(normalizedProcessEnvironment?.diagnostics ?? []),
    ],
  }
}

async function resolveCommandEnvironmentSnapshot(): Promise<CommandEnvironmentSnapshot> {
  const processEnvironmentReason = resolveProcessEnvironmentReason()
  if (processEnvironmentReason) {
    const normalizedProcessEnvironment = normalizeProcessCommandEnvironment(process.env)
    return {
      env: normalizedProcessEnvironment.env,
      shellPath: null,
      source: 'process_env',
      diagnostics: [processEnvironmentReason, ...normalizedProcessEnvironment.diagnostics],
    }
  }

  return toCommandEnvironmentSnapshot(await getShellEnvironmentSnapshot())
}

export async function getCommandEnvironmentSnapshot(): Promise<CommandEnvironmentSnapshot> {
  if (!cachedCommandEnvironmentPromise) {
    cachedCommandEnvironmentPromise = resolveCommandEnvironmentSnapshot()
  }

  return cloneSnapshot(await cachedCommandEnvironmentPromise)
}

export async function getCommandExecutionEnvironment(
  overrides?: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const snapshot = await getCommandEnvironmentSnapshot()
  if (!overrides) {
    return { ...snapshot.env }
  }

  const merged = { ...snapshot.env, ...overrides }
  merged.PATH = mergeExplicitCommandPath(snapshot.env.PATH, overrides.PATH)
  return merged
}

export function disposeCommandEnvironmentService(): void {
  cachedCommandEnvironmentPromise = null
}

export function getTrustProcessEnvironmentMarker(): string {
  return TRUST_PROCESS_ENV_MARKER
}
