import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasSpaceDirectoryOps } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceDirectoryOps'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'

function useDirectoryOpsUnderTest({ nodeStore }: CanvasNodeStoreContext) {
  return useWorkspaceCanvasSpaceDirectoryOps({
    workspacePath: '/repo',
    updateCanvasDocument: nodeStore.updateCanvasDocument,
    closeNode: vi.fn(async () => undefined),
  })
}

const INITIAL_SPACES: WorkspaceSpaceState[] = [
  {
    id: 'space-1',
    name: 'Inbox',
    directoryPath: '/repo',
    targetMountId: null,
    labelColor: null,
    nodeIds: [],
    rect: null,
  },
]

describe('useWorkspaceCanvasSpaceDirectoryOps renameSpaceTo', () => {
  it('has the new directory in the store when the store notifies its consumers', () => {
    const nextDirectoryPath = '/repo/.opencove/worktrees/feat-inbox'
    const harness = createCanvasDocumentHarness({ spaces: INITIAL_SPACES })
    const view = renderCanvasNodeStore(harness, {
      workspacePath: '/repo',
      extend: useDirectoryOpsUnderTest,
    })
    let directorySeenWhenNotified: string | null = null
    const unsubscribe = useAppStore.subscribe(() => {
      directorySeenWhenNotified = harness.readStoreDocument().spaces[0]?.directoryPath ?? null
    })

    act(() => {
      view.result.current.updateSpaceDirectory('space-1', nextDirectoryPath, {
        renameSpaceTo: 'feat/inbox',
      })
    })
    unsubscribe()

    expect(directorySeenWhenNotified).toBe(nextDirectoryPath)
  })

  it('updates the space name when binding a worktree directory', () => {
    const closeNode = vi.fn(async () => undefined)
    const harness = createCanvasDocumentHarness({ spaces: INITIAL_SPACES })
    const view = renderCanvasNodeStore(harness, {
      workspacePath: '/repo',
      extend: function useDirectoryOps({ nodeStore }: CanvasNodeStoreContext) {
        return useWorkspaceCanvasSpaceDirectoryOps({
          workspacePath: '/repo',
          updateCanvasDocument: nodeStore.updateCanvasDocument,
          closeNode,
        })
      },
    })

    act(() => {
      view.result.current.updateSpaceDirectory('space-1', '/repo/.opencove/worktrees/feat-inbox', {
        renameSpaceTo: 'feat/inbox',
      })
    })

    const space = harness.readStoreDocument().spaces[0]
    expect(space?.name).toBe('feat/inbox')
    expect(space?.directoryPath).toBe('/repo/.opencove/worktrees/feat-inbox')
    expect(closeNode).not.toHaveBeenCalled()
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })
})
