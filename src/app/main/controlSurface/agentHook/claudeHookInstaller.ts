import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { AgentHookInstallState } from '../../../../shared/contracts/dto'

export const MANAGED_CLAUDE_HOOK_STATUS_MESSAGE = 'OpenCove agent status'

type JsonRecord = Record<string, unknown>

export interface ClaudeHookInstallResult {
  state: AgentHookInstallState
  detail: string | null
}

interface ManagedHookDefinition {
  eventName: string
  matcher?: string
}

const MANAGED_HOOKS: ManagedHookDefinition[] = [
  { eventName: 'UserPromptSubmit' },
  { eventName: 'PreToolUse' },
  { eventName: 'PermissionRequest' },
  { eventName: 'PostToolUse' },
  { eventName: 'PostToolUseFailure' },
  { eventName: 'PermissionDenied' },
  {
    eventName: 'Notification',
    matcher:
      'permission_prompt|idle_prompt|agent_needs_input|auth_success|elicitation_dialog|elicitation_url_dialog|elicitation_complete|elicitation_response',
  },
  { eventName: 'Stop' },
  { eventName: 'StopFailure' },
  { eventName: 'SessionEnd' },
]

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isManagedGroup(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.hooks)) {
    return false
  }

  return value.hooks.some(
    hook => isRecord(hook) && hook.statusMessage === MANAGED_CLAUDE_HOOK_STATUS_MESSAGE,
  )
}

function managedGroup(
  definition: ManagedHookDefinition,
  helperCommand: string,
  helperArgs: string[],
  platform: NodeJS.Platform,
): JsonRecord {
  const command = buildHelperCommand(helperCommand, helperArgs, platform)
  return {
    ...(definition.matcher ? { matcher: definition.matcher } : {}),
    hooks: [
      {
        type: 'command',
        command,
        ...(platform === 'win32' ? { shell: 'powershell' } : {}),
        timeout: 5,
        statusMessage: MANAGED_CLAUDE_HOOK_STATUS_MESSAGE,
      },
    ],
  }
}

function buildHelperCommand(
  helperCommand: string,
  helperArgs: string[],
  platform: NodeJS.Platform,
): string {
  if (platform === 'win32') {
    const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`
    return `$env:ELECTRON_RUN_AS_NODE='1'; & ${[helperCommand, ...helperArgs].map(quote).join(' ')}`
  }

  const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`
  return `ELECTRON_RUN_AS_NODE=1 ${[helperCommand, ...helperArgs].map(quote).join(' ')}`
}

function settingsPath(homeDirectory: string): string {
  return join(homeDirectory, '.claude', 'settings.json')
}

async function readSettings(path: string): Promise<JsonRecord> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }

  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) {
    throw new Error('Claude settings root must be a JSON object.')
  }
  return parsed
}

async function writeSettingsAtomic(path: string, settings: JsonRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.opencove-${process.pid}-${randomBytes(6).toString('hex')}.tmp`
  try {
    const serialized = `${JSON.stringify(settings, null, 2)}\n`
    JSON.parse(serialized)
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function removeManagedGroups(settings: JsonRecord): { settings: JsonRecord; count: number } {
  const hooks = isRecord(settings.hooks) ? settings.hooks : null
  if (!hooks) {
    return { settings, count: 0 }
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

  const nextSettings = { ...settings }
  if (Object.keys(nextHooks).length > 0) {
    nextSettings.hooks = nextHooks
  } else {
    delete nextSettings.hooks
  }
  return { settings: nextSettings, count }
}

export function classifyManagedClaudeHookInstallState(value: unknown): AgentHookInstallState {
  if (!isRecord(value)) {
    return 'error'
  }
  if (value.disableAllHooks === true || value.allowManagedHooksOnly === true) {
    return 'skipped'
  }
  const hooks = isRecord(value.hooks) ? value.hooks : null
  if (!hooks) {
    return 'not_installed'
  }
  const installedEvents = new Set(
    MANAGED_HOOKS.filter(definition => {
      const groups = hooks[definition.eventName]
      return Array.isArray(groups) && groups.some(isManagedGroup)
    }).map(definition => definition.eventName),
  )
  if (installedEvents.size === 0) {
    return 'not_installed'
  }
  return installedEvents.size === MANAGED_HOOKS.length ? 'installed' : 'partial'
}

export async function installManagedClaudeHooks(options: {
  homeDirectory: string
  helperCommand: string
  helperArgs?: string[]
  platform?: NodeJS.Platform
}): Promise<ClaudeHookInstallResult> {
  const path = settingsPath(options.homeDirectory)
  try {
    const current = await readSettings(path)
    if (current.disableAllHooks === true || current.allowManagedHooksOnly === true) {
      return {
        state: 'skipped',
        detail: current.disableAllHooks === true ? 'disable_all_hooks' : 'managed_hooks_only',
      }
    }

    const withoutManaged = removeManagedGroups(current).settings
    const hooks: JsonRecord = isRecord(withoutManaged.hooks) ? { ...withoutManaged.hooks } : {}
    for (const definition of MANAGED_HOOKS) {
      const currentGroups = Array.isArray(hooks[definition.eventName])
        ? [...(hooks[definition.eventName] as unknown[])]
        : []
      currentGroups.push(
        managedGroup(
          definition,
          options.helperCommand,
          options.helperArgs ?? [],
          options.platform ?? process.platform,
        ),
      )
      hooks[definition.eventName] = currentGroups
    }

    const nextSettings = { ...withoutManaged, hooks }
    await writeSettingsAtomic(path, nextSettings)
    return { state: classifyManagedClaudeHookInstallState(nextSettings), detail: null }
  } catch (error) {
    return {
      state: 'error',
      detail: error instanceof Error ? error.message : 'Unknown hook installation error.',
    }
  }
}

export async function removeManagedClaudeHooks(options: {
  homeDirectory: string
}): Promise<ClaudeHookInstallResult> {
  const path = settingsPath(options.homeDirectory)
  try {
    const current = await readSettings(path)
    const result = removeManagedGroups(current)
    if (result.count > 0) {
      await writeSettingsAtomic(path, result.settings)
    }
    return { state: 'not_installed', detail: null }
  } catch (error) {
    return {
      state: 'error',
      detail: error instanceof Error ? error.message : 'Unknown hook removal error.',
    }
  }
}
