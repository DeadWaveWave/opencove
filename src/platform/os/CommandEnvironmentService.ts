import process from 'node:process'
import {
  getShellEnvironmentSnapshot,
  sanitizeCapturedShellEnvironment,
  type ShellEnvironmentSnapshot,
} from './ShellEnvironmentService'

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

function toCommandEnvironmentSnapshot(
  shellSnapshot: ShellEnvironmentSnapshot,
): CommandEnvironmentSnapshot {
  const source = shellSnapshot.source === 'process_env' ? 'process_env' : 'shell_env'
  return {
    env:
      source === 'shell_env'
        ? sanitizeCapturedShellEnvironment(shellSnapshot.env)
        : { ...shellSnapshot.env },
    shellPath: shellSnapshot.shellPath,
    source,
    diagnostics: [...shellSnapshot.diagnostics],
  }
}

async function resolveCommandEnvironmentSnapshot(): Promise<CommandEnvironmentSnapshot> {
  const processEnvironmentReason = resolveProcessEnvironmentReason()
  if (processEnvironmentReason) {
    return {
      env: { ...process.env },
      shellPath: null,
      source: 'process_env',
      diagnostics: [processEnvironmentReason],
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

  return { ...snapshot.env, ...overrides }
}

export function disposeCommandEnvironmentService(): void {
  cachedCommandEnvironmentPromise = null
}

export function getTrustProcessEnvironmentMarker(): string {
  return TRUST_PROCESS_ENV_MARKER
}
