import { resolve } from 'node:path'

export function normalizeAgentProjectRootPath(pathContents: string): string | null {
  const trimmed = pathContents.trim()
  return trimmed.length > 0 ? resolve(trimmed) : null
}
