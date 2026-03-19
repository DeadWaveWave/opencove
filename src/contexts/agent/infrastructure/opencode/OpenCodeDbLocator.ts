import fs from 'node:fs/promises'
import { join } from 'node:path'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'

function normalizeEnvPath(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

function createOpenCodeDbCandidatePaths(): string[] {
  const xdgDataHome = normalizeEnvPath(process.env.XDG_DATA_HOME)
  const localAppData =
    normalizeEnvPath(process.env.LOCALAPPDATA) ?? normalizeEnvPath(process.env.APPDATA)
  const home = resolveHomeDirectory()

  return [
    ...(xdgDataHome ? [join(xdgDataHome, 'opencode', 'opencode.db')] : []),
    join(home, '.local', 'share', 'opencode', 'opencode.db'),
    ...(localAppData ? [join(localAppData, 'opencode', 'opencode.db')] : []),
    ...(process.platform === 'darwin'
      ? [
          join(home, 'Library', 'Application Support', 'opencode', 'opencode.db'),
          join(home, 'Library', 'Application Support', 'ai.opencode.desktop', 'opencode.db'),
        ]
      : []),
  ]
}

export async function resolveOpenCodeDbPath(): Promise<string | null> {
  const candidateDbPaths = createOpenCodeDbCandidatePaths()

  const resolved = (
    await Promise.all(
      candidateDbPaths.map(async filePath => {
        try {
          const stats = await fs.stat(filePath)
          return stats.isFile() ? filePath : null
        } catch {
          return null
        }
      }),
    )
  ).find((filePath): filePath is string => typeof filePath === 'string')

  return resolved ?? null
}
