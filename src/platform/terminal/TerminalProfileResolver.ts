import { execFile } from 'node:child_process'
import os from 'node:os'
import process from 'node:process'
import type { ListTerminalProfilesResult, SpawnTerminalInput } from '../../shared/contracts/dto'
import {
  buildPowerShellExecArgs,
  findProfileById,
  inferLegacyRuntimeKind,
  isBashLikeWindowsCommand,
  isPowerShellCommand,
  loadWindowsProfiles,
  resolveWindowsHostCwd,
  type ResolvedTerminalSpawn,
  type TerminalProfileResolverDeps,
} from './TerminalProfileResolver.windows'

export interface ResolveCommandSpawnInput {
  cwd: string
  command: string
  args: string[]
  profileId?: string | null
  env?: NodeJS.ProcessEnv
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }

      resolve(typeof stdout === 'string' ? stdout : '')
    })
  })
}

function dedupeStrings(values: string[]): string[] {
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const normalized = value.trim()
    if (normalized.length === 0) {
      continue
    }

    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(normalized)
  }

  return deduped
}

async function locateWindowsCommands(commands: readonly string[]): Promise<string[]> {
  const resolved = (
    await Promise.all(
      commands.map(async command => {
        try {
          const stdout = await execFileText('where.exe', [command])
          return stdout
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0)
        } catch {
          return []
        }
      }),
    )
  ).flat()

  return dedupeStrings(resolved)
}

async function listWslDistros(): Promise<string[]> {
  try {
    const stdout = await execFileText('wsl.exe', ['--list', '--quiet'])
    return dedupeStrings(
      stdout
        .split(/\r?\n/)
        .map(line => line.replaceAll('\u0000', '').trim())
        .filter(line => line.length > 0),
    )
  } catch {
    return []
  }
}

function resolvePosixShell(shell: string | undefined): string {
  const normalized = typeof shell === 'string' ? shell.trim() : ''
  if (normalized.length > 0) {
    return normalized
  }

  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

function hasMeaningfulEnvValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function withTerminalCapabilityEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  if (platform !== 'win32') {
    return env
  }

  const nextEnv = { ...env }

  if (!hasMeaningfulEnvValue(nextEnv.TERM)) {
    nextEnv.TERM = 'xterm-256color'
  }

  if (!hasMeaningfulEnvValue(nextEnv.COLORTERM)) {
    nextEnv.COLORTERM = 'truecolor'
  }

  if (!hasMeaningfulEnvValue(nextEnv.TERM_PROGRAM)) {
    nextEnv.TERM_PROGRAM = 'OpenCove'
  }

  if (!hasMeaningfulEnvValue(nextEnv.CLICOLOR) && !hasMeaningfulEnvValue(nextEnv.NO_COLOR)) {
    nextEnv.CLICOLOR = '1'
  }

  return nextEnv
}

export class TerminalProfileResolver {
  private readonly deps: TerminalProfileResolverDeps

  public constructor(overrides: Partial<TerminalProfileResolverDeps> = {}) {
    this.deps = {
      platform: overrides.platform ?? process.platform,
      env: overrides.env ?? (() => process.env),
      homeDir: overrides.homeDir ?? (() => os.homedir()),
      processCwd: overrides.processCwd ?? (() => process.cwd()),
      locateWindowsCommands: overrides.locateWindowsCommands ?? locateWindowsCommands,
      listWslDistros: overrides.listWslDistros ?? listWslDistros,
    }
  }

  public async listProfiles(): Promise<ListTerminalProfilesResult> {
    if (this.deps.platform !== 'win32') {
      return { profiles: [], defaultProfileId: null }
    }

    const snapshot = await loadWindowsProfiles(this.deps)
    return {
      profiles: snapshot.profiles.map(({ id, label, runtimeKind }) => ({
        id,
        label,
        runtimeKind,
      })),
      defaultProfileId: snapshot.defaultProfileId,
    }
  }

  public async resolveTerminalSpawn(input: SpawnTerminalInput): Promise<ResolvedTerminalSpawn> {
    const env = withTerminalCapabilityEnv({ ...this.deps.env() }, this.deps.platform)

    if (this.deps.platform !== 'win32') {
      const shell = input.shell ?? resolvePosixShell(this.deps.env().SHELL)
      return {
        command: shell,
        args: [],
        cwd: input.cwd,
        env,
        profileId: null,
        runtimeKind: 'posix',
      }
    }

    if (typeof input.shell === 'string' && input.shell.trim().length > 0) {
      return {
        command: input.shell.trim(),
        args: [],
        cwd: resolveWindowsHostCwd(input.cwd, this.deps.homeDir().trim(), this.deps.processCwd()),
        env,
        profileId: null,
        runtimeKind: inferLegacyRuntimeKind(input.shell, this.deps.platform),
      }
    }

    const snapshot = await loadWindowsProfiles(this.deps)
    const selectedProfile =
      findProfileById(snapshot.profiles, input.profileId) ??
      findProfileById(snapshot.profiles, snapshot.defaultProfileId) ??
      null

    if (selectedProfile) {
      return selectedProfile.resolveSpawn(input.cwd, env)
    }

    return {
      command: 'powershell.exe',
      args: [],
      cwd: resolveWindowsHostCwd(input.cwd, this.deps.homeDir().trim(), this.deps.processCwd()),
      env,
      profileId: null,
      runtimeKind: 'windows',
    }
  }

  public async resolveCommandSpawn(
    input: ResolveCommandSpawnInput,
  ): Promise<ResolvedTerminalSpawn> {
    const command = input.command.trim()
    const args = [...input.args]
    const env = {
      ...this.deps.env(),
      ...(input.env ?? {}),
    }
    const resolvedEnv = withTerminalCapabilityEnv(env, this.deps.platform)

    if (this.deps.platform !== 'win32') {
      return {
        command,
        args,
        cwd: input.cwd,
        env: resolvedEnv,
        profileId: input.profileId?.trim() || null,
        runtimeKind: 'posix',
      }
    }

    const snapshot = await loadWindowsProfiles(this.deps)
    const selectedProfile =
      findProfileById(snapshot.profiles, input.profileId) ??
      findProfileById(snapshot.profiles, snapshot.defaultProfileId) ??
      null

    if (!selectedProfile) {
      return {
        command,
        args,
        cwd: resolveWindowsHostCwd(input.cwd, this.deps.homeDir().trim(), this.deps.processCwd()),
        env: resolvedEnv,
        profileId: null,
        runtimeKind: 'windows',
      }
    }

    const shellSpawn = selectedProfile.resolveSpawn(input.cwd, resolvedEnv)
    const profileId = selectedProfile.id

    if (selectedProfile.runtimeKind === 'wsl') {
      const envPairs = Object.entries(input.env ?? {}).flatMap(([key, value]) =>
        typeof value === 'string' ? [`${key}=${value}`] : [],
      )
      return {
        command: shellSpawn.command,
        args: [
          ...shellSpawn.args,
          ...(envPairs.length > 0 ? ['env', ...envPairs] : []),
          command,
          ...args,
        ],
        cwd: shellSpawn.cwd,
        env: shellSpawn.env,
        profileId,
        runtimeKind: 'wsl',
      }
    }

    if (isBashLikeWindowsCommand(shellSpawn.command)) {
      return {
        command: shellSpawn.command,
        args: ['--login', '-c', 'exec "$@"', 'bash', command, ...args],
        cwd: shellSpawn.cwd,
        env: shellSpawn.env,
        profileId,
        runtimeKind: selectedProfile.runtimeKind,
      }
    }

    if (isPowerShellCommand(shellSpawn.command)) {
      return {
        command: shellSpawn.command,
        args: buildPowerShellExecArgs(command, args, shellSpawn.cwd),
        cwd: shellSpawn.cwd,
        env: shellSpawn.env,
        profileId,
        runtimeKind: selectedProfile.runtimeKind,
      }
    }

    return {
      command,
      args,
      cwd: shellSpawn.cwd,
      env: shellSpawn.env,
      profileId,
      runtimeKind: selectedProfile.runtimeKind,
    }
  }
}
