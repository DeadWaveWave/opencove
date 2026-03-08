import type { CreateGitWorktreeBranchMode } from '@shared/contracts/dto'

export type BranchMode = 'new' | 'existing'
export type SpaceWorktreeViewMode = 'home' | 'create' | 'archive'

export interface BlockingNodesSnapshot {
  agentNodeIds: string[]
  terminalNodeIds: string[]
}

export interface UpdateSpaceDirectoryOptions {
  markNodeDirectoryMismatch?: boolean
  archiveSpace?: boolean
  renameSpaceTo?: string
}

export type PendingOperation =
  | {
      kind: 'create'
      worktreesRoot: string
      branchMode: CreateGitWorktreeBranchMode
    }
  | {
      kind: 'archive'
      worktreePath: string
      deleteBranch: boolean
      archiveSpace: boolean
      force: boolean
    }

const WORKTREE_API_UNAVAILABLE_ERROR =
  'Worktree API is unavailable. Please restart Cove and try again.'
const DISALLOWED_BRANCH_CHARACTERS = [' ', '~', '^', ':', '?', '*', '[', '\\']

type WorktreeApiClient = Window['coveApi']['worktree']

export function getWorktreeApiMethod<K extends keyof WorktreeApiClient>(
  method: K,
): WorktreeApiClient[K] {
  const worktreeApi = (
    window as Window & {
      coveApi?: { worktree?: Partial<WorktreeApiClient> }
    }
  ).coveApi?.worktree

  const candidate = worktreeApi?.[method]
  if (typeof candidate !== 'function') {
    throw new Error(WORKTREE_API_UNAVAILABLE_ERROR)
  }

  return candidate as WorktreeApiClient[K]
}

export function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/[\\/]+$/, '')
}

export function resolveWorktreesRoot(workspacePath: string, worktreesRoot: string): string {
  const trimmed = worktreesRoot.trim()
  if (trimmed.length === 0) {
    return `${workspacePath.replace(/[\\/]+$/, '')}/.cove/worktrees`
  }

  if (/^([a-zA-Z]:[\\/]|\/)/.test(trimmed)) {
    return trimmed.replace(/[\\/]+$/, '')
  }

  const base = workspacePath.replace(/[\\/]+$/, '')
  const normalizedCustom = trimmed
    .replace(/^[.][\\/]+/, '')
    .replace(/^[\\/]+/, '')
    .replace(/[\\/]+$/, '')

  return `${base}/${normalizedCustom}`
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some(character => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
}

export function getBranchNameValidationError(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return 'Branch name cannot be empty.'
  }

  if (trimmed === '@') {
    return 'Branch name cannot be "@".'
  }

  if (trimmed.includes('..')) {
    return 'Branch name cannot contain "..".'
  }

  if (trimmed.includes('@{')) {
    return 'Branch name cannot contain "@{".'
  }

  if (
    hasAsciiControlCharacter(trimmed) ||
    DISALLOWED_BRANCH_CHARACTERS.some(character => trimmed.includes(character))
  ) {
    return 'Branch name contains unsupported characters.'
  }

  if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return 'Branch name cannot start or end with "/".'
  }

  if (trimmed.includes('//')) {
    return 'Branch name cannot contain consecutive "/".'
  }

  if (trimmed.endsWith('.')) {
    return 'Branch name cannot end with ".".'
  }

  const segments = trimmed.split('/')
  if (segments.some(segment => segment.length === 0)) {
    return 'Branch name cannot contain empty path segments.'
  }

  if (segments.some(segment => segment.startsWith('.'))) {
    return 'Branch name segments cannot start with ".".'
  }

  if (segments.some(segment => segment.endsWith('.lock'))) {
    return 'Branch name segments cannot end with ".lock".'
  }

  return null
}
