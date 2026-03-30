import fs from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const STORE_VERSION = 1

interface ApprovedWorkspaceSnapshot {
  version: number
  roots: string[]
}

function normalizePathForComparison(pathValue: string): string {
  const normalized = resolve(pathValue)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath)

  if (relativePath === '') {
    return true
  }

  if (relativePath === '..') {
    return false
  }

  if (relativePath.startsWith(`..${sep}`)) {
    return false
  }

  if (isAbsolute(relativePath)) {
    return false
  }

  return true
}

async function readSnapshot(filePath: string): Promise<ApprovedWorkspaceSnapshot | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const record = parsed as { version?: unknown; roots?: unknown }
    const version = typeof record.version === 'number' ? record.version : null
    const roots = Array.isArray(record.roots) ? record.roots : null

    if (version !== STORE_VERSION || !roots) {
      return null
    }

    const normalizedRoots = roots
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(value => value.length > 0)

    return { version, roots: normalizedRoots }
  } catch {
    return null
  }
}

async function writeSnapshot(filePath: string, roots: string[]): Promise<void> {
  try {
    await fs.mkdir(dirname(filePath), { recursive: true })
    const payload: ApprovedWorkspaceSnapshot = { version: STORE_VERSION, roots }
    await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8')
  } catch {
    // ignore persistence failures (permissions, read-only disks, etc.)
  }
}

export interface ApprovedWorkspaceStore {
  registerRoot: (rootPath: string) => Promise<void>
  isPathApproved: (targetPath: string) => Promise<boolean>
}

export function createApprovedWorkspaceStoreForPath(storePath: string): ApprovedWorkspaceStore {
  const approvedRoots = new Set<string>()
  let loadPromise: Promise<void> | null = null

  const loadOnce = async (): Promise<void> => {
    if (loadPromise) {
      return await loadPromise
    }

    loadPromise = (async () => {
      const snapshot = await readSnapshot(storePath)
      if (!snapshot) {
        return
      }

      snapshot.roots.forEach(root => {
        approvedRoots.add(normalizePathForComparison(root))
      })
    })()

    return await loadPromise
  }

  const persist = async (): Promise<void> => {
    await writeSnapshot(storePath, [...approvedRoots.values()])
  }

  return {
    registerRoot: async rootPath => {
      const trimmed = rootPath.trim()
      if (trimmed.length === 0) {
        return
      }

      const normalized = normalizePathForComparison(trimmed)
      if (approvedRoots.has(normalized)) {
        await loadOnce()
        return
      }

      approvedRoots.add(normalized)
      await loadOnce()
      await persist()
    },
    isPathApproved: async targetPath => {
      const trimmed = targetPath.trim()
      if (trimmed.length === 0) {
        return false
      }

      await loadOnce()

      const normalizedTarget = normalizePathForComparison(trimmed)
      for (const root of approvedRoots) {
        if (isPathWithinRoot(root, normalizedTarget)) {
          return true
        }
      }

      return false
    },
  }
}
