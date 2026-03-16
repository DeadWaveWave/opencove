import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import type {
  ListTerminalProfilesResult,
  SpawnTerminalInput,
  TerminalProfile,
  TerminalRuntimeKind,
} from '../../shared/contracts/dto'

interface InternalTerminalProfile extends TerminalProfile {
  resolveSpawn: (cwd: string, env: NodeJS.ProcessEnv) => ResolvedTerminalSpawn
}

interface TerminalProfileSnapshot {
  profiles: InternalTerminalProfile[]
  defaultProfileId: string | null
}

export interface TerminalProfileResolverDeps {
  platform: NodeJS.Platform
  env: () => NodeJS.ProcessEnv
  homeDir: () => string
  processCwd: () => string
  locateWindowsCommands: (commands: readonly string[]) => Promise<string[]>
  listWslDistros: () => Promise<string[]>
}

export interface ResolvedTerminalSpawn {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  profileId: string | null
  runtimeKind: TerminalRuntimeKind
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

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value)
}

function isWslUncPath(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized.startsWith('\\\\wsl$\\') || normalized.startsWith('\\\\wsl.localhost\\')
}

function convertWindowsPathToWslPath(cwd: string, distro: string): string | null {
  const normalized = cwd.trim()
  const uncPrefix = normalized.toLowerCase().startsWith('\\\\wsl$\\')
    ? '\\\\wsl$\\'
    : normalized.toLowerCase().startsWith('\\\\wsl.localhost\\')
      ? '\\\\wsl.localhost\\'
      : null

  if (uncPrefix) {
    const restPath = normalized.slice(uncPrefix.length)
    const separatorIndex = restPath.indexOf('\\')
    const sourceDistro =
      separatorIndex >= 0 ? restPath.slice(0, separatorIndex).trim() : restPath.trim()
    if (sourceDistro.localeCompare(distro, undefined, { sensitivity: 'base' }) !== 0) {
      return null
    }

    const rest = (separatorIndex >= 0 ? restPath.slice(separatorIndex + 1) : '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    return rest.length > 0 ? `/${rest}` : '/'
  }

  const driveMatch = cwd.match(/^([A-Za-z]):(?:[\\/](.*))?$/)
  if (driveMatch) {
    const drive = driveMatch[1]?.toLowerCase() ?? ''
    const rest = (driveMatch[2] ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
    return rest.length > 0 ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`
  }

  return null
}

function inferLegacyRuntimeKind(shell: string, platform: NodeJS.Platform): TerminalRuntimeKind {
  const normalized = shell.trim().toLowerCase()
  if (normalized.endsWith('wsl.exe') || normalized === 'wsl' || normalized === 'wsl.exe') {
    return 'wsl'
  }

  return platform === 'win32' ? 'windows' : 'posix'
}

function buildBashLabel(shellPath: string): string {
  const normalized = shellPath.toLowerCase()
  if (normalized.includes('\\git\\')) {
    return 'Bash (Git Bash)'
  }

  if (
    normalized.includes('\\msys') ||
    normalized.includes('\\mingw') ||
    normalized.includes('\\ucrt64')
  ) {
    return 'Bash (MSYS2)'
  }

  if (normalized.includes('\\cygwin')) {
    return 'Bash (Cygwin)'
  }

  const container = path.win32.basename(path.win32.dirname(shellPath))
  return container.length > 0 ? `Bash (${container})` : 'Bash'
}

function shouldIncludeWindowsBashProfile(shellPath: string): boolean {
  const normalized = shellPath.trim().toLowerCase()
  if (normalized.length === 0) {
    return false
  }

  return (
    !normalized.endsWith('\\windows\\system32\\bash.exe') &&
    !normalized.includes('\\windowsapps\\bash.exe')
  )
}

function shouldIncludeWslDistro(distro: string): boolean {
  const normalized = distro.trim().toLowerCase()
  if (normalized.length === 0) {
    return false
  }

  return normalized !== 'docker-desktop' && normalized !== 'docker-desktop-data'
}

function disambiguateProfileLabels<T extends TerminalProfile>(profiles: T[]): T[] {
  const counts = new Map<string, number>()
  const labels = profiles.map(profile => {
    const nextCount = (counts.get(profile.label) ?? 0) + 1
    counts.set(profile.label, nextCount)
    return nextCount
  })

  return profiles.map((profile, index) => {
    if ((counts.get(profile.label) ?? 0) <= 1) {
      return profile
    }

    return {
      ...profile,
      label: `${profile.label} ${labels[index]}`,
    }
  })
}

function findProfileById(
  profiles: InternalTerminalProfile[],
  profileId: string | null | undefined,
): InternalTerminalProfile | null {
  const normalizedProfileId = typeof profileId === 'string' ? profileId.trim() : ''
  if (normalizedProfileId.length === 0) {
    return null
  }

  return (
    profiles.find(profile => profile.id === normalizedProfileId) ??
    profiles.find(
      profile =>
        profile.id.localeCompare(normalizedProfileId, undefined, { sensitivity: 'base' }) === 0,
    ) ??
    null
  )
}

async function loadWindowsProfiles(
  deps: TerminalProfileResolverDeps,
): Promise<TerminalProfileSnapshot> {
  const profiles: InternalTerminalProfile[] = []

  const resolveHostCwd = (cwd: string): string => {
    if (isWindowsDrivePath(cwd) || (!isWslUncPath(cwd) && path.win32.isAbsolute(cwd))) {
      return cwd
    }

    const homeDir = deps.homeDir().trim()
    return path.win32.isAbsolute(homeDir) ? homeDir : deps.processCwd()
  }

  const powershellCommands = await deps.locateWindowsCommands(['powershell.exe', 'powershell'])
  if (powershellCommands.length > 0) {
    const command = powershellCommands[0] ?? 'powershell.exe'
    profiles.push({
      id: 'powershell',
      label: 'PowerShell',
      runtimeKind: 'windows',
      resolveSpawn: (cwd, env) => ({
        command,
        args: [],
        cwd: resolveHostCwd(cwd),
        env,
        profileId: 'powershell',
        runtimeKind: 'windows',
      }),
    })
  }

  const pwshCommands = await deps.locateWindowsCommands(['pwsh.exe', 'pwsh'])
  if (pwshCommands.length > 0) {
    const command = pwshCommands[0] ?? 'pwsh.exe'
    profiles.push({
      id: 'pwsh',
      label: 'PowerShell 7',
      runtimeKind: 'windows',
      resolveSpawn: (cwd, env) => ({
        command,
        args: [],
        cwd: resolveHostCwd(cwd),
        env,
        profileId: 'pwsh',
        runtimeKind: 'windows',
      }),
    })
  }

  const bashCommands = (await deps.locateWindowsCommands(['bash.exe', 'bash'])).filter(
    shouldIncludeWindowsBashProfile,
  )
  const bashProfiles = bashCommands.map<InternalTerminalProfile>(command => ({
    id: `bash:${command.toLowerCase()}`,
    label: buildBashLabel(command),
    runtimeKind: 'windows',
    resolveSpawn: (cwd, env) => ({
      command,
      args: [],
      cwd: resolveHostCwd(cwd),
      env: {
        ...env,
        CHERE_INVOKING: '1',
      },
      profileId: `bash:${command.toLowerCase()}`,
      runtimeKind: 'windows',
    }),
  }))
  profiles.push(...disambiguateProfileLabels(bashProfiles))

  const distros = (await deps.listWslDistros()).filter(shouldIncludeWslDistro)
  for (const distro of distros) {
    profiles.push({
      id: `wsl:${distro}`,
      label: `WSL (${distro})`,
      runtimeKind: 'wsl',
      resolveSpawn: (cwd, env) => {
        const linuxCwd = convertWindowsPathToWslPath(cwd, distro)
        return {
          command: 'wsl.exe',
          args: linuxCwd
            ? ['--distribution', distro, '--cd', linuxCwd]
            : ['--distribution', distro],
          cwd: resolveHostCwd(cwd),
          env,
          profileId: `wsl:${distro}`,
          runtimeKind: 'wsl',
        }
      },
    })
  }

  return {
    profiles,
    defaultProfileId: profiles[0]?.id ?? null,
  }
}

function resolvePosixShell(shell: string | undefined): string {
  const normalized = typeof shell === 'string' ? shell.trim() : ''
  if (normalized.length > 0) {
    return normalized
  }

  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
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
    const env = { ...this.deps.env() }

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
        cwd:
          isWindowsDrivePath(input.cwd) ||
          (!isWslUncPath(input.cwd) && path.win32.isAbsolute(input.cwd))
            ? input.cwd
            : this.deps.homeDir().trim(),
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
      cwd:
        isWindowsDrivePath(input.cwd) ||
        (!isWslUncPath(input.cwd) && path.win32.isAbsolute(input.cwd))
          ? input.cwd
          : this.deps.homeDir().trim(),
      env,
      profileId: null,
      runtimeKind: 'windows',
    }
  }
}
