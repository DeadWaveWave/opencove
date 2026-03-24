import type { Node } from '@xyflow/react'
import type { GitHubPullRequestSummary, GitWorktreeInfo } from '@shared/contracts/dto'
import { isLabelColor, type LabelColor } from '@shared/types/labelColor'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'

export type WorkspaceSearchHit = {
  id: string
  kind: 'task' | 'note' | 'space'
  nodeId?: string
  spaceId?: string
  title: string
  subtitle: string
  score: number
  effectiveLabelColor: LabelColor | null
  context: {
    space: {
      id: string
      name: string
      labelColor: LabelColor | null
    } | null
    branch: {
      name: string
      head: string | null
    } | null
    pullRequest: GitHubPullRequestSummary | null
  }
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}

function fuzzyScore(candidate: string, query: string): number | null {
  if (!query) {
    return 0
  }

  const haystack = candidate.toLowerCase()
  let lastIndex = -1
  let score = 0

  for (const needleChar of query) {
    const nextIndex = haystack.indexOf(needleChar, lastIndex + 1)
    if (nextIndex === -1) {
      return null
    }

    const gap = nextIndex - lastIndex - 1
    score += gap === 0 ? 15 : Math.max(2, 12 - gap)
    lastIndex = nextIndex
  }

  if (haystack.startsWith(query)) {
    score += 20
  } else if (haystack.includes(query)) {
    score += 12
  }

  return score
}

function toSingleLineSnippet(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/[\\/]+$/, '')
}

function resolveWorktreeInfo(
  directoryPath: string,
  workspacePath: string,
  worktreeInfoByPath: Map<string, GitWorktreeInfo> | null,
): GitWorktreeInfo | null {
  if (!worktreeInfoByPath) {
    return null
  }

  const normalizedDirectoryPath = normalizeComparablePath(directoryPath)
  const normalizedWorkspacePath = normalizeComparablePath(workspacePath)
  if (normalizedDirectoryPath.length === 0 || normalizedDirectoryPath === normalizedWorkspacePath) {
    return null
  }

  return worktreeInfoByPath.get(normalizedDirectoryPath) ?? null
}

function resolvePullRequestSummary(
  worktreeInfo: GitWorktreeInfo | null,
  pullRequestsByBranch: Record<string, GitHubPullRequestSummary | null> | null,
): GitHubPullRequestSummary | null {
  if (!worktreeInfo || !pullRequestsByBranch) {
    return null
  }

  const branch = worktreeInfo.branch?.trim() ?? ''
  if (branch.length === 0) {
    return null
  }

  return pullRequestsByBranch[branch] ?? null
}

function toEffectiveLabelColor(
  node: Node<TerminalNodeData>,
  inheritedLabelColorByNodeId: Map<string, LabelColor>,
): LabelColor | null {
  const overrideRaw = (node.data.labelColorOverride ?? null) as unknown
  if (overrideRaw === 'none') {
    return null
  }

  if (isLabelColor(overrideRaw)) {
    return overrideRaw
  }

  return inheritedLabelColorByNodeId.get(node.id) ?? null
}

function buildInheritedLabelColorByNodeId(spaces: WorkspaceSpaceState[]): Map<string, LabelColor> {
  const map = new Map<string, LabelColor>()

  for (const space of spaces) {
    if (!space.labelColor) {
      continue
    }

    for (const nodeId of space.nodeIds) {
      if (!map.has(nodeId)) {
        map.set(nodeId, space.labelColor)
      }
    }
  }

  return map
}

function buildSpaceByNodeId(spaces: WorkspaceSpaceState[]): Map<string, WorkspaceSpaceState> {
  const map = new Map<string, WorkspaceSpaceState>()

  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      if (!map.has(nodeId)) {
        map.set(nodeId, space)
      }
    }
  }

  return map
}

export function searchWorkspace({
  nodes,
  spaces,
  query,
  workspacePath,
  worktreeInfoByPath,
  pullRequestsByBranch,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  query: string
  workspacePath: string
  worktreeInfoByPath: Map<string, GitWorktreeInfo> | null
  pullRequestsByBranch: Record<string, GitHubPullRequestSummary | null> | null
}): WorkspaceSearchHit[] {
  const normalizedQuery = normalizeQuery(query)
  const hits: Array<WorkspaceSearchHit & { index: number }> = []

  const spaceByNodeId = buildSpaceByNodeId(spaces)
  const inheritedLabelColorByNodeId = buildInheritedLabelColorByNodeId(spaces)

  spaces.forEach((space, index) => {
    const worktreeInfo = resolveWorktreeInfo(space.directoryPath, workspacePath, worktreeInfoByPath)
    const pullRequest = resolvePullRequestSummary(worktreeInfo, pullRequestsByBranch)
    const branchName = worktreeInfo?.branch?.trim() ?? ''
    const head = worktreeInfo?.head?.trim() ?? null
    const branchKey = branchName.length > 0 ? branchName : head ? head : ''

    const candidateText = [
      space.name,
      space.directoryPath,
      branchName,
      head,
      pullRequest ? `#${pullRequest.number}` : '',
      pullRequest?.title ?? '',
    ]
      .filter(Boolean)
      .join('\n')

    const score = fuzzyScore(candidateText, normalizedQuery)
    if (score === null) {
      return
    }

    hits.push({
      index: nodes.length + index,
      id: `space:${space.id}`,
      spaceId: space.id,
      kind: 'space',
      title: space.name,
      subtitle: toSingleLineSnippet(space.directoryPath),
      score,
      effectiveLabelColor: space.labelColor,
      context: {
        space: {
          id: space.id,
          name: space.name,
          labelColor: space.labelColor,
        },
        branch:
          branchKey.length > 0
            ? {
                name: branchName.length > 0 ? branchName : branchKey,
                head: branchName.length > 0 ? null : head,
              }
            : null,
        pullRequest,
      },
    })
  })

  nodes.forEach((node, index) => {
    const kind = node.data.kind
    const space = spaceByNodeId.get(node.id) ?? null
    const worktreeInfo =
      space && space.directoryPath.length > 0
        ? resolveWorktreeInfo(space.directoryPath, workspacePath, worktreeInfoByPath)
        : null
    const pullRequest = resolvePullRequestSummary(worktreeInfo, pullRequestsByBranch)
    const branchName = worktreeInfo?.branch?.trim() ?? ''
    const head = worktreeInfo?.head?.trim() ?? null

    if (kind === 'task' && node.data.task) {
      const title = node.data.title
      const requirement = node.data.task.requirement
      const subtitle = toSingleLineSnippet(requirement)
      const candidateText = [
        title,
        requirement,
        space?.name ?? '',
        branchName,
        head,
        pullRequest ? `#${pullRequest.number}` : '',
        pullRequest?.title ?? '',
      ]
        .filter(Boolean)
        .join('\n')
      const score = fuzzyScore(candidateText, normalizedQuery)
      if (score === null) {
        return
      }

      hits.push({
        index,
        id: `task:${node.id}`,
        nodeId: node.id,
        kind,
        title,
        subtitle,
        score,
        effectiveLabelColor: toEffectiveLabelColor(node, inheritedLabelColorByNodeId),
        context: {
          space: space
            ? {
                id: space.id,
                name: space.name,
                labelColor: space.labelColor,
              }
            : null,
          branch:
            branchName.length > 0 || head
              ? {
                  name: branchName.length > 0 ? branchName : (head ?? ''),
                  head: branchName.length > 0 ? null : head,
                }
              : null,
          pullRequest,
        },
      })
      return
    }

    if (kind === 'note' && node.data.note) {
      const title = node.data.title
      const text = node.data.note.text
      const subtitle = toSingleLineSnippet(text)
      const candidateText = [
        title,
        text,
        space?.name ?? '',
        branchName,
        head,
        pullRequest ? `#${pullRequest.number}` : '',
        pullRequest?.title ?? '',
      ]
        .filter(Boolean)
        .join('\n')
      const score = fuzzyScore(candidateText, normalizedQuery)
      if (score === null) {
        return
      }

      hits.push({
        index,
        id: `note:${node.id}`,
        nodeId: node.id,
        kind,
        title,
        subtitle,
        score,
        effectiveLabelColor: toEffectiveLabelColor(node, inheritedLabelColorByNodeId),
        context: {
          space: space
            ? {
                id: space.id,
                name: space.name,
                labelColor: space.labelColor,
              }
            : null,
          branch:
            branchName.length > 0 || head
              ? {
                  name: branchName.length > 0 ? branchName : (head ?? ''),
                  head: branchName.length > 0 ? null : head,
                }
              : null,
          pullRequest,
        },
      })
    }
  })

  const MAX_RESULTS = 250

  return hits
    .sort((left, right) => {
      const scoreDelta = right.score - left.score
      if (scoreDelta !== 0) {
        return scoreDelta
      }

      return left.index - right.index
    })
    .slice(0, MAX_RESULTS)
}
