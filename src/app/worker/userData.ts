import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function normalizeEnvPath(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

function resolveAppDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const homeDir = os.homedir()

  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support')
  }

  if (platform === 'win32') {
    return env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
  }

  return env.XDG_CONFIG_HOME || path.join(homeDir, '.config')
}

export function resolveWorkerUserDataDir(): string {
  const explicit = normalizeEnvPath(process.env.OPENCOVE_USER_DATA_DIR)
  if (explicit) {
    return path.resolve(explicit)
  }

  const appDataDir = resolveAppDataDir(process.env, process.platform)
  const devCandidate = path.join(appDataDir, 'opencove-dev')
  const stableCandidate = path.join(appDataDir, 'opencove')

  if (fs.existsSync(devCandidate)) {
    return devCandidate
  }

  return stableCandidate
}
