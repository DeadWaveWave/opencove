import { describe, expect, it } from 'vitest'
import { mergePersistedAppStates } from '@shared/sync/mergePersistedAppStates'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import type {
  PersistedAppState,
  WorkspaceSpaceRect,
} from '@contexts/workspace/presentation/renderer/types'

function createState(options: {
  rect: WorkspaceSpaceRect
  nodeTitle: string
  nodePosition?: { x: number; y: number }
}): PersistedAppState {
  const nodePosition = options.nodePosition ?? { x: 0, y: 0 }
  return {
    formatVersion: 1,
    activeWorkspaceId: 'w1',
    settings: DEFAULT_AGENT_SETTINGS,
    workspaces: [
      {
        id: 'w1',
        name: 'Workspace',
        path: '/tmp/workspace',
        worktreesRoot: '/tmp/workspace',
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [
          {
            id: 's1',
            name: 'Space',
            directoryPath: '/tmp/workspace',
            labelColor: null,
            nodeIds: ['n1'],
            rect: options.rect,
          },
        ],
        activeSpaceId: 's1',
        spaceArchiveRecords: [],
        nodes: [
          {
            id: 'n1',
            title: options.nodeTitle,
            position: nodePosition,
            width: 120,
            height: 90,
            kind: 'note',
            status: null,
            startedAt: null,
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: null,
            agent: null,
            task: { text: '' },
          },
        ],
      },
    ],
  }
}

describe('mergePersistedAppStates', () => {
  it('keeps base space rect when local did not change it (snapshot-aware)', () => {
    const snapshotRect: WorkspaceSpaceRect = { x: 0, y: 0, width: 100, height: 100 }
    const expandedRect: WorkspaceSpaceRect = { x: 0, y: 0, width: 180, height: 120 }

    const baseSnapshot = createState({ rect: snapshotRect, nodeTitle: 'snapshot' })
    const base = createState({
      rect: expandedRect,
      nodeTitle: 'base',
      nodePosition: { x: 50, y: 25 },
    })
    const local = createState({ rect: snapshotRect, nodeTitle: 'local-change' })

    const merged = mergePersistedAppStates(base, local, baseSnapshot)

    expect(merged.workspaces[0]?.spaces[0]?.rect).toEqual(expandedRect)
    expect(merged.workspaces[0]?.nodes[0]?.title).toBe('local-change')
    expect(merged.workspaces[0]?.nodes[0]?.position).toEqual({ x: 50, y: 25 })
  })

  it('keeps local space rect when base did not change it (snapshot-aware)', () => {
    const snapshotRect: WorkspaceSpaceRect = { x: 0, y: 0, width: 100, height: 100 }
    const localRect: WorkspaceSpaceRect = { x: 10, y: 20, width: 160, height: 140 }

    const baseSnapshot = createState({ rect: snapshotRect, nodeTitle: 'snapshot' })
    const base = createState({ rect: snapshotRect, nodeTitle: 'base' })
    const local = createState({ rect: localRect, nodeTitle: 'local-change' })

    const merged = mergePersistedAppStates(base, local, baseSnapshot)

    expect(merged.workspaces[0]?.spaces[0]?.rect).toEqual(localRect)
  })
})
