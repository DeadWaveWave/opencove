import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { AgentHookInstallState } from '../../../../shared/contracts/dto'

export const MANAGED_CODEX_HOOK_DESCRIPTION = 'OpenCove managed agent status hooks'
export const MANAGED_CODEX_HOOK_STATUS_MESSAGE = 'OpenCove agent status'

const MANAGED_EVENTS = [
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
] as const

type JsonRecord = Record<string, unknown>

export interface CodexHookInstallResult {
  state: AgentHookInstallState
  detail: string | null
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isManagedGroup(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.hooks)) {
    return false
  }
  return value.hooks.some(
    hook => isRecord(hook) && hook.statusMessage === MANAGED_CODEX_HOOK_STATUS_MESSAGE,
  )
}

function hooksPath(homeDirectory: string): string {
  return join(homeDirectory, '.codex', 'hooks.json')
}

async function readJsonFile(path: string): Promise<JsonRecord> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!isRecord(parsed)) {
      throw new Error('Codex hooks root must be a JSON object.')
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

async function readOptionalText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

function tomlSectionBoolean(raw: string, section: string, key: string): boolean | null {
  let currentSection = ''
  for (const rawLine of raw.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, '').trim()
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line)
    if (sectionMatch) {
      currentSection = sectionMatch[1]?.trim() ?? ''
      continue
    }
    if (currentSection !== section) {
      continue
    }
    const valueMatch = new RegExp(`^${key}\\s*=\\s*(true|false)\\s*$`, 'u').exec(line)
    if (valueMatch) {
      return valueMatch[1] === 'true'
    }
  }
  return null
}

function tomlBoolean(raw: string, key: string): boolean | null {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, 'mu')
  const match = pattern.exec(raw)
  return match ? match[1] === 'true' : null
}

async function resolveOptOut(homeDirectory: string): Promise<string | null> {
  const [config, requirements] = await Promise.all([
    readOptionalText(join(homeDirectory, '.codex', 'config.toml')),
    readOptionalText(join(homeDirectory, '.codex', 'requirements.toml')),
  ])
  if (
    tomlSectionBoolean(config, 'features', 'hooks') === false ||
    tomlSectionBoolean(config, 'features', 'codex_hooks') === false
  ) {
    return 'hooks_disabled'
  }
  if (tomlBoolean(requirements, 'allow_managed_hooks_only') === true) {
    return 'managed_hooks_only'
  }
  return null
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function managedGroup(helperCommand: string, helperArgs: string[]): JsonRecord {
  const values = [helperCommand, ...helperArgs]
  return {
    hooks: [
      {
        type: 'command',
        command: `ELECTRON_RUN_AS_NODE=1 ${values.map(quotePosix).join(' ')}`,
        commandWindows: `$env:ELECTRON_RUN_AS_NODE='1'; & ${values.map(quotePowerShell).join(' ')}`,
        timeout: 5,
        statusMessage: MANAGED_CODEX_HOOK_STATUS_MESSAGE,
      },
    ],
  }
}

function removeManagedGroups(config: JsonRecord): { config: JsonRecord; count: number } {
  const hooks = isRecord(config.hooks) ? config.hooks : null
  if (!hooks) {
    return { config, count: 0 }
  }

  let count = 0
  const nextHooks: JsonRecord = { ...hooks }
  for (const [eventName, rawGroups] of Object.entries(hooks)) {
    if (!Array.isArray(rawGroups)) {
      continue
    }
    const groups = rawGroups.filter(group => {
      if (!isManagedGroup(group)) {
        return true
      }
      count += 1
      return false
    })
    if (groups.length > 0) {
      nextHooks[eventName] = groups
    } else {
      delete nextHooks[eventName]
    }
  }

  const nextConfig = { ...config }
  if (Object.keys(nextHooks).length > 0) {
    nextConfig.hooks = nextHooks
  } else {
    delete nextConfig.hooks
  }
  if (nextConfig.description === MANAGED_CODEX_HOOK_DESCRIPTION) {
    delete nextConfig.description
  }
  return { config: nextConfig, count }
}

async function writeJsonAtomic(path: string, config: JsonRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.opencove-${process.pid}-${randomBytes(6).toString('hex')}.tmp`
  try {
    const serialized = `${JSON.stringify(config, null, 2)}\n`
    JSON.parse(serialized)
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export function classifyManagedCodexHookInstallState(value: unknown): AgentHookInstallState {
  if (!isRecord(value)) {
    return 'error'
  }
  const hooks = isRecord(value.hooks) ? value.hooks : null
  if (!hooks) {
    return 'not_installed'
  }
  const installedEvents = MANAGED_EVENTS.filter(eventName => {
    const groups = hooks[eventName]
    return Array.isArray(groups) && groups.some(isManagedGroup)
  })
  if (installedEvents.length === 0) {
    return 'not_installed'
  }
  return installedEvents.length === MANAGED_EVENTS.length ? 'installed' : 'partial'
}

export async function installManagedCodexHooks(options: {
  homeDirectory: string
  helperCommand: string
  helperArgs?: string[]
}): Promise<CodexHookInstallResult> {
  const path = hooksPath(options.homeDirectory)
  try {
    const optOut = await resolveOptOut(options.homeDirectory)
    if (optOut) {
      return { state: 'skipped', detail: optOut }
    }

    const current = await readJsonFile(path)
    const withoutManaged = removeManagedGroups(current).config
    const hooks: JsonRecord = isRecord(withoutManaged.hooks) ? { ...withoutManaged.hooks } : {}
    for (const eventName of MANAGED_EVENTS) {
      const groups = Array.isArray(hooks[eventName]) ? [...(hooks[eventName] as unknown[])] : []
      groups.push(managedGroup(options.helperCommand, options.helperArgs ?? []))
      hooks[eventName] = groups
    }
    const nextConfig = {
      ...withoutManaged,
      ...(!('description' in withoutManaged)
        ? { description: MANAGED_CODEX_HOOK_DESCRIPTION }
        : {}),
      hooks,
    }
    await writeJsonAtomic(path, nextConfig)
    return { state: classifyManagedCodexHookInstallState(nextConfig), detail: null }
  } catch (error) {
    return {
      state: 'error',
      detail: error instanceof Error ? error.message : 'Unknown hook installation error.',
    }
  }
}

export async function removeManagedCodexHooks(options: {
  homeDirectory: string
}): Promise<CodexHookInstallResult> {
  const path = hooksPath(options.homeDirectory)
  try {
    const current = await readJsonFile(path)
    const result = removeManagedGroups(current)
    if (result.count > 0) {
      await writeJsonAtomic(path, result.config)
    }
    return { state: 'not_installed', detail: null }
  } catch (error) {
    return {
      state: 'error',
      detail: error instanceof Error ? error.message : 'Unknown hook removal error.',
    }
  }
}
