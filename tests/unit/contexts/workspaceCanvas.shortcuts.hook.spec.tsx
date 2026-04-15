import React from 'react'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasShortcuts } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts'

function createNode(
  id: string,
  kind: TerminalNodeData['kind'],
  status: TerminalNodeData['status'] = null,
): Node<TerminalNodeData> {
  return {
    id,
    type: kind === 'note' ? 'noteNode' : 'terminalNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId: id,
      title: id,
      width: 100,
      height: 100,
      kind,
      status,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent:
        kind === 'agent'
          ? {
              provider: 'codex',
              prompt: id,
              model: null,
              effectiveModel: null,
              launchMode: 'new',
              resumeSessionId: null,
              executionDirectory: '/tmp',
              expectedDirectory: '/tmp',
              directoryMode: 'workspace',
              customDirectory: null,
              shouldCreateDirectory: false,
              taskId: null,
            }
          : null,
      task: null,
      note: null,
    },
  }
}

function ShortcutHarness(props: React.ComponentProps<typeof useWorkspaceCanvasShortcuts>) {
  useWorkspaceCanvasShortcuts(props)
  return <div />
}

describe('useWorkspaceCanvasShortcuts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cycles only idle spaces when shifted bracket shortcuts are pressed', () => {
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-idle-a',
        name: 'Idle A',
        directoryPath: '/tmp/idle-a',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['note-1'],
        rect: null,
      },
      {
        id: 'space-working',
        name: 'Working',
        directoryPath: '/tmp/working',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['agent-1'],
        rect: null,
      },
      {
        id: 'space-idle-b',
        name: 'Idle B',
        directoryPath: '/tmp/idle-b',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['agent-2'],
        rect: null,
      },
    ]
    const nodesRef = {
      current: [
        createNode('note-1', 'note'),
        createNode('agent-1', 'agent', 'running'),
        createNode('agent-2', 'agent', 'standby'),
      ],
    }

    const activateSpace = vi.fn()

    const { rerender } = render(
      <ShortcutHarness
        enabled
        platform="darwin"
        keybindings={{}}
        disableWhenTerminalFocused={false}
        activeSpaceId={null}
        spaces={spaces}
        nodesRef={nodesRef}
        createSpaceFromSelectedNodes={() => undefined}
        createNoteAtViewportCenter={() => undefined}
        createTerminalAtViewportCenter={async () => undefined}
        activateSpace={activateSpace}
      />,
    )

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '}',
        code: 'BracketRight',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(activateSpace).toHaveBeenLastCalledWith('space-idle-a')

    rerender(
      <ShortcutHarness
        enabled
        platform="darwin"
        keybindings={{}}
        disableWhenTerminalFocused={false}
        activeSpaceId="space-idle-a"
        spaces={spaces}
        nodesRef={nodesRef}
        createSpaceFromSelectedNodes={() => undefined}
        createNoteAtViewportCenter={() => undefined}
        createTerminalAtViewportCenter={async () => undefined}
        activateSpace={activateSpace}
      />,
    )

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '}',
        code: 'BracketRight',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(activateSpace).toHaveBeenLastCalledWith('space-idle-b')
  })
})
