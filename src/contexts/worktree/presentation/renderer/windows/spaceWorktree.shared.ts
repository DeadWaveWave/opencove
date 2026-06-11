import type {
  CreateGitWorktreeBranchMode,
  GitWorktreeInfo,
  RemoveGitWorktreeResult,
} from '@shared/contracts/dto'
import type { TranslateFn } from '@app/renderer/i18n'

export type BranchMode = 'new' | 'existing'
export type SpaceWorktreeViewMode = 'create' | 'archive'

export interface BlockingNodesSnapshot {
  agentNodeIds: string[]
  terminalNodeIds: string[]
}

export interface UpdateSpaceDirectoryOptions {
  markNodeDirectoryMismatch?: boolean
  archiveSpace?: boolean
  renameSpaceTo?: string
  targetMountId?: string | null
}

export interface ArchiveWorktreeCleanup {
  spaceId: string
  worktreePath: string
  deleteBranch: boolean
}

export type PendingOperation =
  | {
      kind: 'create'
      worktreesRoot: string
      branchMode: CreateGitWorktreeBranchMode
    }
  | {
      kind: 'archive'
      worktreeCleanups: ArchiveWorktreeCleanup[]
      archiveSpace: boolean
      force: boolean
    }

const DISALLOWED_BRANCH_CHARACTERS = [' ', '~', '^', ':', '?', '*', '[', '\\']

export type WorktreeApiClient = Window['opencoveApi']['worktree']

export function getWorktreeApiMethod<K extends keyof WorktreeApiClient>(
  worktreeApi: Partial<WorktreeApiClient> | null | undefined,
  method: K,
  t: TranslateFn,
): WorktreeApiClient[K] {
  const candidate = worktreeApi?.[method]
  if (typeof candidate !== 'function') {
    throw new Error(t('worktree.apiUnavailable'))
  }

  return candidate as WorktreeApiClient[K]
}

export async function removeArchiveWorktreesInOrder({
  cleanups,
  force,
  removeWorktree,
  repoPath,
}: {
  cleanups: ArchiveWorktreeCleanup[]
  force: boolean
  removeWorktree: WorktreeApiClient['remove']
  repoPath: string
}): Promise<RemoveGitWorktreeResult[]> {
  return cleanups.reduce<Promise<RemoveGitWorktreeResult[]>>(async (previousResults, cleanup) => {
    const results = await previousResults
    const result = await removeWorktree({
      repoPath,
      worktreePath: cleanup.worktreePath,
      force,
      deleteBranch: cleanup.deleteBranch,
    })
    return [...results, result]
  }, Promise.resolve([]))
}

export function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/[\\/]+$/, '')
}

export function resolveWorktreeRepoRootPath(
  workspacePath: string,
  worktrees: GitWorktreeInfo[],
): string {
  const normalizedWorkspacePath = normalizeComparablePath(workspacePath)
  const match =
    worktrees.find(entry => normalizeComparablePath(entry.path) === normalizedWorkspacePath) ?? null
  if (match) {
    return match.path
  }

  // Some callers provide a worktree snapshot without including the main workspace root (e.g. unit
  // tests or partial snapshots). If the workspace path is a parent directory of a worktree, treat
  // it as the repo root.
  const hasWorktreeUnderWorkspace = worktrees.some(entry => {
    const normalizedWorktreePath = normalizeComparablePath(entry.path)
    return (
      normalizedWorkspacePath.length > 0 &&
      normalizedWorktreePath.startsWith(`${normalizedWorkspacePath}/`)
    )
  })
  if (hasWorktreeUnderWorkspace) {
    return workspacePath
  }

  let shortest: { normalized: string; path: string } | null = null
  for (const entry of worktrees) {
    const normalized = normalizeComparablePath(entry.path)
    if (normalized.length === 0) {
      continue
    }
    if (!shortest || normalized.length < shortest.normalized.length) {
      shortest = { normalized, path: entry.path }
    }
  }

  return shortest?.path ?? workspacePath
}

export function resolveWorktreesRoot(workspacePath: string, worktreesRoot: string): string {
  const trimmed = worktreesRoot.trim()
  if (trimmed.length === 0) {
    return `${workspacePath.replace(/[\\/]+$/, '')}/.opencove/worktrees`
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

export function getBranchNameValidationError(value: string, t: TranslateFn): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return t('worktree.branchValidation.empty')
  }

  if (trimmed === '@') {
    return t('worktree.branchValidation.atSymbol')
  }

  if (trimmed.includes('..')) {
    return t('worktree.branchValidation.doubleDot')
  }

  if (trimmed.includes('@{')) {
    return t('worktree.branchValidation.atBrace')
  }

  if (
    hasAsciiControlCharacter(trimmed) ||
    DISALLOWED_BRANCH_CHARACTERS.some(character => trimmed.includes(character))
  ) {
    return t('worktree.branchValidation.unsupportedCharacters')
  }

  if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return t('worktree.branchValidation.slashBoundary')
  }

  if (trimmed.includes('//')) {
    return t('worktree.branchValidation.consecutiveSlash')
  }

  if (trimmed.endsWith('.')) {
    return t('worktree.branchValidation.trailingDot')
  }

  const segments = trimmed.split('/')
  if (segments.some(segment => segment.length === 0)) {
    return t('worktree.branchValidation.emptySegment')
  }

  if (segments.some(segment => segment.startsWith('.'))) {
    return t('worktree.branchValidation.leadingDotSegment')
  }

  if (segments.some(segment => segment.endsWith('.lock'))) {
    return t('worktree.branchValidation.trailingLock')
  }

  return null
}
