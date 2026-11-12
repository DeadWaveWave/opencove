import { resolveAgentNodeSize } from './workspaceNodeSizing'
import { SPACE_MIN_SIZE, SPACE_NODE_PADDING } from './workspaceSpaceLayout'
import type { StandardWindowSizeBucket } from '../../settings/domain/agentSettings'

export function createProjectRecord(input: { id: string; name: string; path: string }) {
  return {
    ...input,
    nodes: [],
    worktreesRoot: '',
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
    spaces: [] as ReturnType<typeof createTopLevelSpaceRecord>[],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    pullRequestBaseBranchOptions: [],
    environmentVariables: {},
  }
}

export function emptySpaceSize(bucket: StandardWindowSizeBucket) {
  const size = resolveAgentNodeSize({ bucket })
  return {
    width: Math.max(SPACE_MIN_SIZE.width, size.width + SPACE_NODE_PADDING * 2),
    height: Math.max(SPACE_MIN_SIZE.height, size.height + SPACE_NODE_PADDING * 2),
  }
}

export function createTopLevelSpaceRecord(input: {
  id: string
  name: string
  directoryPath: string
  targetMountId: string | null
  rect: { x: number; y: number; width: number; height: number } | null
}) {
  return { ...input, labelColor: null, nodeIds: [] as string[] }
}
