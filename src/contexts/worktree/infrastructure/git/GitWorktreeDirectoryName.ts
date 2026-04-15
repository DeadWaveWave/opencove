import { randomBytes } from 'node:crypto'

function toSafeWorktreeDirectorySeed(branchName: string): string {
  const slug = branchName
    .trim()
    .toLowerCase()
    .replace(/[\s._/\\]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  return slug.length > 0 ? slug : 'worktree'
}

export function buildCandidateWorktreeDirectoryName(branchName: string): string {
  return `${toSafeWorktreeDirectorySeed(branchName)}--${randomBytes(4).toString('hex')}`
}
