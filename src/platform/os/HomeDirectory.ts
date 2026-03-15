import os from 'node:os'

interface ComputeHomeDirectoryInput {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  osHomeDir: string
}

function normalizeEnvPath(value: string | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

export function computeHomeDirectory(input: ComputeHomeDirectoryInput): string {
  const homeFromEnv = normalizeEnvPath(input.env.HOME)
  if (homeFromEnv) {
    return homeFromEnv
  }

  if (input.platform === 'win32') {
    const userProfile = normalizeEnvPath(input.env.USERPROFILE)
    if (userProfile) {
      return userProfile
    }

    const homeDrive = normalizeEnvPath(input.env.HOMEDRIVE) ?? ''
    const homePath = normalizeEnvPath(input.env.HOMEPATH) ?? ''
    const combined = `${homeDrive}${homePath}`.trim()
    if (combined.length > 0) {
      return combined
    }
  }

  return input.osHomeDir.trim()
}

export function resolveHomeDirectory(): string {
  return computeHomeDirectory({
    env: process.env,
    platform: process.platform,
    osHomeDir: os.homedir(),
  })
}
