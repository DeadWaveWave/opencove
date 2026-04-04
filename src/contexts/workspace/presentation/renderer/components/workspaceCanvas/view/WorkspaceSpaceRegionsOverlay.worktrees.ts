import type { GitWorktreeInfo } from '@shared/contracts/dto'

export function isWorktreeInfoMapEqual(
  left: Map<string, GitWorktreeInfo>,
  right: Map<string, GitWorktreeInfo>,
): boolean {
  if (left.size !== right.size) {
    return false
  }

  for (const [key, rightValue] of right) {
    const leftValue = left.get(key)
    if (!leftValue) {
      return false
    }

    if (
      leftValue.path !== rightValue.path ||
      leftValue.branch !== rightValue.branch ||
      leftValue.head !== rightValue.head
    ) {
      return false
    }
  }

  return true
}
