import path from 'node:path'
import type { TerminalProfile, TerminalRuntimeKind } from '../../shared/contracts/dto'

export interface TerminalProfileResolverDeps {
  platform: NodeJS.Platform
  env: () => NodeJS.ProcessEnv
  homeDir: () => string
  processCwd: () => string
  locateWindowsCommands: (commands: readonly string[]) => Promise<string[]>
  listWslDistros: () => Promise<string[]>
  commandDiscoveryTimeoutMs: number
}

export interface ResolvedTerminalSpawn {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  profileId: string | null
  runtimeKind: TerminalRuntimeKind
}

export interface InternalTerminalProfile extends TerminalProfile {
  resolveSpawn: (cwd: string, env: NodeJS.ProcessEnv) => ResolvedTerminalSpawn
}

export interface TerminalProfileSnapshot {
  profiles: InternalTerminalProfile[]
  defaultProfileId: string | null
}

async function withDiscoveryTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      operation,
      new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallback), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== null) {
      clearTimeout(timer)
    }
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

export function inferLegacyRuntimeKind(
  shell: string,
  platform: NodeJS.Platform,
): TerminalRuntimeKind {
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

export function findProfileById(
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

export function resolveWindowsHostCwd(cwd: string, homeDir: string, processCwd: string): string {
  if (isWindowsDrivePath(cwd) || (!isWslUncPath(cwd) && path.win32.isAbsolute(cwd))) {
    return cwd
  }

  return path.win32.isAbsolute(homeDir) ? homeDir : processCwd
}

export async function loadWindowsProfiles(
  deps: TerminalProfileResolverDeps,
): Promise<TerminalProfileSnapshot> {
  const profiles: InternalTerminalProfile[] = []
  const resolveHostCwd = (cwd: string): string =>
    resolveWindowsHostCwd(cwd, deps.homeDir().trim(), deps.processCwd())

  const powershellCommands = await withDiscoveryTimeout(
    deps.locateWindowsCommands(['powershell.exe', 'powershell']),
    deps.commandDiscoveryTimeoutMs,
    [],
  )
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

  const pwshCommands = await withDiscoveryTimeout(
    deps.locateWindowsCommands(['pwsh.exe', 'pwsh']),
    deps.commandDiscoveryTimeoutMs,
    [],
  )
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

  const bashCommands = (
    await withDiscoveryTimeout(
      deps.locateWindowsCommands(['bash.exe', 'bash']),
      deps.commandDiscoveryTimeoutMs,
      [],
    )
  ).filter(shouldIncludeWindowsBashProfile)
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

  const distros = (
    await withDiscoveryTimeout(deps.listWslDistros(), deps.commandDiscoveryTimeoutMs, [])
  ).filter(shouldIncludeWslDistro)
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

export function isBashLikeWindowsCommand(command: string): boolean {
  const normalized = path.win32.basename(command).trim().toLowerCase()
  return normalized === 'bash.exe' || normalized === 'bash'
}

export function isPowerShellCommand(command: string): boolean {
  const normalized = path.win32.basename(command).trim().toLowerCase()
  return (
    normalized === 'powershell.exe' ||
    normalized === 'powershell' ||
    normalized === 'pwsh.exe' ||
    normalized === 'pwsh'
  )
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function buildPowerShellExecArgs(command: string, args: string[], cwd: string): string[] {
  const invocation = [quotePowerShellLiteral(command), ...args.map(quotePowerShellLiteral)].join(
    ' ',
  )
  const script = `Set-Location -LiteralPath ${quotePowerShellLiteral(cwd)}; & ${invocation}; exit $LASTEXITCODE`
  return ['-NoLogo', '-Command', script]
}
