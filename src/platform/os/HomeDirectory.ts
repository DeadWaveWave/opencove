import os from 'node:os'

interface ComputeHomeDirectoryInput {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  osHomeDir: string
}

interface ComputeHomeDirectoryCandidatesInput extends ComputeHomeDirectoryInput {
  osUserInfoHomeDir?: string | null
}

function normalizeEnvPath(value: string | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

function normalizeHomeDirectoryCandidate(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function createHomeDirectoryCandidateKey(candidate: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return candidate.replace(/\//g, '\\').toLowerCase()
  }

  return candidate
}

function appendUniqueHomeDirectoryCandidate(
  candidates: string[],
  candidate: string | null,
  platform: NodeJS.Platform,
): void {
  const normalizedCandidate = normalizeHomeDirectoryCandidate(candidate)
  if (!normalizedCandidate) {
    return
  }

  const key = createHomeDirectoryCandidateKey(normalizedCandidate, platform)
  if (candidates.some(existing => createHomeDirectoryCandidateKey(existing, platform) === key)) {
    return
  }

  candidates.push(normalizedCandidate)
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

export function computeHomeDirectoryCandidates(
  input: ComputeHomeDirectoryCandidatesInput,
): string[] {
  const candidates: string[] = []

  appendUniqueHomeDirectoryCandidate(candidates, computeHomeDirectory(input), input.platform)

  if (input.platform === 'win32') {
    appendUniqueHomeDirectoryCandidate(
      candidates,
      normalizeEnvPath(input.env.USERPROFILE),
      input.platform,
    )

    const homeDrive = normalizeEnvPath(input.env.HOMEDRIVE) ?? ''
    const homePath = normalizeEnvPath(input.env.HOMEPATH) ?? ''
    const combined = `${homeDrive}${homePath}`.trim()

    appendUniqueHomeDirectoryCandidate(candidates, combined, input.platform)
    appendUniqueHomeDirectoryCandidate(candidates, input.osUserInfoHomeDir ?? null, input.platform)
    appendUniqueHomeDirectoryCandidate(candidates, input.osHomeDir, input.platform)
  }

  return candidates
}

export function resolveHomeDirectory(): string {
  return computeHomeDirectory({
    env: process.env,
    platform: process.platform,
    osHomeDir: os.homedir(),
  })
}

export function resolveHomeDirectoryCandidates(): string[] {
  let userInfoHomeDir: string | null = null

  try {
    userInfoHomeDir = normalizeHomeDirectoryCandidate(os.userInfo().homedir)
  } catch {
    userInfoHomeDir = null
  }

  return computeHomeDirectoryCandidates({
    env: process.env,
    platform: process.platform,
    osHomeDir: os.homedir(),
    osUserInfoHomeDir: userInfoHomeDir,
  })
}
