import type { CreateGitWorktreeBranchMode } from '@shared/contracts/dto'
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
}

export type PendingOperation =
  | {
      kind: 'create'
      worktreesRoot: string
      branchMode: CreateGitWorktreeBranchMode
    }
  | {
      kind: 'archive'
      worktreePath: string | null
      deleteBranch: boolean
      archiveSpace: boolean
      force: boolean
    }

const DISALLOWED_BRANCH_CHARACTERS = [' ', '~', '^', ':', '?', '*', '[', '\\']

type WorktreeApiClient = Window['opencoveApi']['worktree']

export function getWorktreeApiMethod<K extends keyof WorktreeApiClient>(
  method: K,
  t: TranslateFn,
): WorktreeApiClient[K] {
  const worktreeApi = (
    window as Window & {
      opencoveApi?: { worktree?: Partial<WorktreeApiClient> }
    }
  ).opencoveApi?.worktree

  const candidate = worktreeApi?.[method]
  if (typeof candidate !== 'function') {
    throw new Error(t('worktree.apiUnavailable'))
  }

  return candidate as WorktreeApiClient[K]
}

export function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/[\\/]+$/, '')
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
