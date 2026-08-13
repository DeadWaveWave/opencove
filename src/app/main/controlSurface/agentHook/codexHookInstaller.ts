import { randomBytes } from 'node:crypto'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentHookInstallState } from '../../../../shared/contracts/dto'
import {
  buildManagedCodexHookCommand,
  buildManagedCodexHookScript,
  CODEX_HOOK_EVENTS,
} from '../../../../shared/runtime/codexHookRuntime'
import { grantManagedCodexHookTrust } from './codexHookTrustGrant'

export const MANAGED_CODEX_HOOK_DESCRIPTION = 'OpenCove managed agent status hooks'
export const MANAGED_CODEX_HOOK_TIMEOUT_SECONDS = 10

type JsonRecord = Record<string, unknown>

export interface CodexHookInstallResult {
  state: AgentHookInstallState
  detail: string | null
  runtimeHome?: string
  scriptPath?: string
}

export interface ManagedCodexRuntimePaths {
  runtimeHome: string
  hooksPath: string
  scriptPath: string
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function resolveManagedCodexRuntimePaths(options: {
  homeDirectory: string
  userDataDirectory?: string
  runtimeHomeDirectory?: string
  scriptPath?: string
}): ManagedCodexRuntimePaths {
  const runtimeHome =
    options.runtimeHomeDirectory ??
    join(
      options.userDataDirectory ?? join(options.homeDirectory, '.opencove'),
      'codex-runtime-home',
      'home',
    )
  return {
    runtimeHome,
    hooksPath: join(runtimeHome, 'hooks.json'),
    scriptPath:
      options.scriptPath ??
      join(options.homeDirectory, '.opencove', 'agent-hooks', 'codex-hook.sh'),
  }
}

async function readJsonFile(path: string): Promise<JsonRecord> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!isRecord(parsed)) {
      throw new Error('Hook configuration root must be a JSON object.')
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
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, 'mu').exec(raw)
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
  return tomlBoolean(requirements, 'allow_managed_hooks_only') === true
    ? 'managed_hooks_only'
    : null
}

function isManagedGroup(value: unknown, command?: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.hooks)) {
    return false
  }
  return value.hooks.some(
    hook =>
      isRecord(hook) &&
      hook.type === 'command' &&
      typeof hook.command === 'string' &&
      (hook.statusMessage === 'OpenCove agent status' ||
        hook.command.includes('codex-status.mjs') ||
        hook.command === command ||
        hook.command.includes('/.opencove/agent-hooks/codex-hook.sh') ||
        (hook.command.startsWith('if [ -f ') &&
          hook.command.includes('{ command -p cat 2>/dev/null || cat; }'))),
  )
}

function managedGroup(command: string): JsonRecord {
  return {
    hooks: [
      {
        type: 'command',
        command,
        timeout: MANAGED_CODEX_HOOK_TIMEOUT_SECONDS,
      },
    ],
  }
}

function removeManagedGroups(
  config: JsonRecord,
  command?: string,
): { config: JsonRecord; count: number } {
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
      if (!isManagedGroup(group, command)) {
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

async function writeAtomic(path: string, contents: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.opencove-${process.pid}-${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode })
    await chmod(temporaryPath, mode)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function writeJsonAtomic(path: string, config: JsonRecord): Promise<void> {
  const serialized = `${JSON.stringify(config, null, 2)}\n`
  JSON.parse(serialized)
  await writeAtomic(path, serialized, 0o600)
}

async function linkUserResource(
  userHome: string,
  runtimeHome: string,
  name: string,
): Promise<void> {
  const source = join(userHome, '.codex', name)
  const target = join(runtimeHome, name)
  try {
    await lstat(source)
  } catch {
    return
  }
  try {
    await lstat(target)
    return
  } catch {
    await symlink(source, target)
  }
}

async function prepareRuntimeHome(userHome: string, runtimeHome: string): Promise<void> {
  await mkdir(runtimeHome, { recursive: true, mode: 0o700 })
  await Promise.all(
    ['config.toml', 'hooks.json'].map(async fileName => {
      const target = join(runtimeHome, fileName)
      try {
        await lstat(target)
      } catch {
        await copyFile(join(userHome, '.codex', fileName), target).catch(() => undefined)
      }
    }),
  )
  await Promise.all(
    ['auth.json', 'AGENTS.md', 'skills', 'plugins'].map(
      async name => await linkUserResource(userHome, runtimeHome, name),
    ),
  )
}

export function classifyManagedCodexHookInstallState(value: unknown): AgentHookInstallState {
  if (!isRecord(value)) {
    return 'error'
  }
  const hooks = isRecord(value.hooks) ? value.hooks : null
  if (!hooks) {
    return 'not_installed'
  }
  const installed = CODEX_HOOK_EVENTS.filter(eventName => {
    const groups = hooks[eventName]
    return Array.isArray(groups) && groups.some(group => isManagedGroup(group))
  })
  if (installed.length === 0) {
    return 'not_installed'
  }
  return installed.length === CODEX_HOOK_EVENTS.length ? 'installed' : 'partial'
}

export async function installManagedCodexHooks(options: {
  homeDirectory: string
  userDataDirectory?: string
  runtimeHomeDirectory?: string
  scriptPath?: string
  codexExecutable?: string
  trustGrantEntryPath?: string
}): Promise<CodexHookInstallResult> {
  const paths = resolveManagedCodexRuntimePaths(options)
  try {
    const optOut = await resolveOptOut(options.homeDirectory)
    if (optOut) {
      return { state: 'skipped', detail: optOut, ...paths }
    }
    await prepareRuntimeHome(options.homeDirectory, paths.runtimeHome)
    await writeAtomic(paths.scriptPath, buildManagedCodexHookScript(), 0o700)
    const command = buildManagedCodexHookCommand(paths.scriptPath)
    const current = await readJsonFile(paths.hooksPath)
    const withoutManaged = removeManagedGroups(current, command).config
    const hooks: JsonRecord = isRecord(withoutManaged.hooks) ? { ...withoutManaged.hooks } : {}
    for (const eventName of CODEX_HOOK_EVENTS) {
      const userGroups = Array.isArray(hooks[eventName]) ? [...(hooks[eventName] as unknown[])] : []
      hooks[eventName] = [managedGroup(command), ...userGroups]
    }
    const nextConfig = {
      ...withoutManaged,
      ...(!('description' in withoutManaged)
        ? { description: MANAGED_CODEX_HOOK_DESCRIPTION }
        : {}),
      hooks,
    }
    await writeJsonAtomic(paths.hooksPath, nextConfig)
    const normalizedHooksPath = await realpath(paths.hooksPath).catch(() => paths.hooksPath)
    await grantManagedCodexHookTrust({
      runtimeHome: paths.runtimeHome,
      executable: options.codexExecutable ?? 'codex',
      entryPath: options.trustGrantEntryPath,
      entries: CODEX_HOOK_EVENTS.map(eventName => ({
        eventName,
        command,
        timeoutSeconds: MANAGED_CODEX_HOOK_TIMEOUT_SECONDS,
        sourcePath: normalizedHooksPath,
      })),
    })
    return {
      state: classifyManagedCodexHookInstallState(nextConfig),
      detail: null,
      runtimeHome: paths.runtimeHome,
      scriptPath: paths.scriptPath,
    }
  } catch (error) {
    return {
      state: 'error',
      detail: error instanceof Error ? error.message : 'Unknown hook installation error.',
      runtimeHome: paths.runtimeHome,
      scriptPath: paths.scriptPath,
    }
  }
}

export async function removeManagedCodexHooks(options: {
  homeDirectory: string
  userDataDirectory?: string
  runtimeHomeDirectory?: string
}): Promise<CodexHookInstallResult> {
  const paths = resolveManagedCodexRuntimePaths(options)
  try {
    const current = await readJsonFile(paths.hooksPath)
    const result = removeManagedGroups(current)
    if (result.count > 0) {
      await writeJsonAtomic(paths.hooksPath, result.config)
    }
    return { state: 'not_installed', detail: null, ...paths }
  } catch (error) {
    return {
      state: 'error',
      detail: error instanceof Error ? error.message : 'Unknown hook removal error.',
      ...paths,
    }
  }
}
