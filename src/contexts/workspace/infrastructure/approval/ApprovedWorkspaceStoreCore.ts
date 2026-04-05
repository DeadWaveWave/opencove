import fs from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const STORE_VERSION = 1

interface ApprovedWorkspaceSnapshot {
  version: number
  roots: string[]
}

function normalizeResolvedPathForComparison(pathValue: string): string {
  const normalized = resolve(pathValue)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function toCanonicalPathEvenIfMissing(pathValue: string): Promise<string> {
  const normalized = resolve(pathValue)

  try {
    return await fs.realpath(normalized)
  } catch {
    // Walk up the directory chain until we can resolve an existing parent. This lets us
    // canonicalize paths that do not exist yet (e.g. `.opencove/worktrees`) while still
    // handling macOS `/var` -> `/private/var` style symlinks.
    const parentCandidates: string[] = []
    let current = normalized
    let parent = dirname(current)

    while (parent !== current) {
      parentCandidates.push(parent)
      current = parent
      parent = dirname(current)
    }

    const resolvedParents = await Promise.all(
      parentCandidates.map(async candidate => {
        try {
          return await fs.realpath(candidate)
        } catch {
          return null
        }
      }),
    )

    for (let index = 0; index < parentCandidates.length; index += 1) {
      const realParent = resolvedParents[index]
      if (!realParent) {
        continue
      }

      const suffix = relative(parentCandidates[index], normalized)
      return resolve(realParent, suffix)
    }

    return normalized
  }
}

async function normalizePathForComparison(pathValue: string): Promise<string> {
  const canonical = await toCanonicalPathEvenIfMissing(pathValue)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
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

      const normalizedRoots = await Promise.all(
        snapshot.roots.map(root => normalizePathForComparison(root)),
      )
      normalizedRoots.forEach(root => {
        approvedRoots.add(root)
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

      await loadOnce()

      const normalized = await normalizePathForComparison(trimmed)
      if (approvedRoots.has(normalized)) {
        return
      }

      approvedRoots.add(normalized)
      await persist()
    },
    isPathApproved: async targetPath => {
      const trimmed = targetPath.trim()
      if (trimmed.length === 0) {
        return false
      }

      await loadOnce()

      const resolvedTarget = normalizeResolvedPathForComparison(trimmed)
      for (const root of approvedRoots) {
        if (isPathWithinRoot(root, resolvedTarget)) {
          return true
        }
      }

      const canonicalTarget = await normalizePathForComparison(trimmed)
      if (canonicalTarget === resolvedTarget) {
        return false
      }

      for (const root of approvedRoots) {
        if (isPathWithinRoot(root, canonicalTarget)) {
          return true
        }
      }

      return false
    },
  }
}
