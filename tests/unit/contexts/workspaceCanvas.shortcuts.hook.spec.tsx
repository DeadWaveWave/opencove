import React from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  CANVAS_STORE_TEST_WORKSPACE_ID,
  CanvasStoreTestProvider,
} from '../../support/canvasStoreTestHarness'
import {
  replaceSpacesInStore,
  seedWorkspaceCanvasStore,
} from '../../support/workspaceCanvasStoreHarness'
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

function ShortcutHarnessBody(props: Parameters<typeof useWorkspaceCanvasShortcuts>[0]) {
  useWorkspaceCanvasShortcuts(props)
  return <div />
}

function ShortcutHarness(props: Parameters<typeof useWorkspaceCanvasShortcuts>[0]) {
  return (
    <CanvasStoreTestProvider>
      <ShortcutHarnessBody {...props} />
    </CanvasStoreTestProvider>
  )
}

describe('useWorkspaceCanvasShortcuts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
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
    seedWorkspaceCanvasStore({
      workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
      nodes: [
        createNode('note-1', 'note'),
        createNode('agent-1', 'agent', 'running'),
        createNode('agent-2', 'agent', 'standby'),
      ],
      spaces,
    })

    const activateSpace = vi.fn()

    const { rerender } = render(
      <ShortcutHarness
        enabled
        platform="darwin"
        keybindings={{}}
        disableWhenTerminalFocused={false}
        activeSpaceId={null}
        createSpaceFromSelectedNodes={() => undefined}
        createNoteAtViewportCenter={() => undefined}
        createTerminalAtViewportCenter={async () => undefined}
        createAgentAtViewportCenter={async () => undefined}
        canvasRef={{ current: null }}
        activateSpace={activateSpace}
        navigateNode={() => undefined}
        navigateSpace={() => undefined}
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
        createSpaceFromSelectedNodes={() => undefined}
        createNoteAtViewportCenter={() => undefined}
        createTerminalAtViewportCenter={async () => undefined}
        createAgentAtViewportCenter={async () => undefined}
        canvasRef={{ current: null }}
        activateSpace={activateSpace}
        navigateNode={() => undefined}
        navigateSpace={() => undefined}
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

  it('captures spatial navigation shortcuts even when an editable terminal target is focused', () => {
    const navigateNode = vi.fn()

    render(
      <ShortcutHarness
        enabled
        platform="darwin"
        keybindings={{}}
        disableWhenTerminalFocused
        activeSpaceId={null}
        createSpaceFromSelectedNodes={() => undefined}
        createNoteAtViewportCenter={() => undefined}
        createTerminalAtViewportCenter={async () => undefined}
        createAgentAtViewportCenter={async () => undefined}
        canvasRef={{ current: null }}
        activateSpace={() => undefined}
        navigateNode={navigateNode}
        navigateSpace={() => undefined}
      />,
    )

    const terminalScope = document.createElement('div')
    terminalScope.setAttribute('data-cove-focus-scope', 'terminal')
    const textarea = document.createElement('textarea')
    terminalScope.appendChild(textarea)
    document.body.appendChild(terminalScope)

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        code: 'ArrowRight',
        metaKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )

    expect(navigateNode).toHaveBeenCalledWith('right')
  })

  describe('cycling the Spaces', () => {
    const space = (id: string, extra: Partial<WorkspaceSpaceState> = {}): WorkspaceSpaceState => ({
      id,
      name: id,
      directoryPath: `/tmp/${id}`,
      targetMountId: null,
      labelColor: null,
      nodeIds: [],
      rect: null,
      ...extra,
    })
    const pressBracket = (code: 'BracketLeft' | 'BracketRight', shiftKey = false) =>
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: code === 'BracketRight' ? (shiftKey ? '}' : ']') : shiftKey ? '{' : '[',
            code,
            metaKey: true,
            shiftKey,
            bubbles: true,
            cancelable: true,
          }),
        )
      })
    function mountShortcuts(activeSpaceId: string | null) {
      const activateSpace = vi.fn()
      const props = {
        enabled: true,
        platform: 'darwin',
        keybindings: {},
        disableWhenTerminalFocused: false,
        createSpaceFromSelectedNodes: () => undefined,
        createNoteAtViewportCenter: () => undefined,
        createTerminalAtViewportCenter: async () => undefined,
        createAgentAtViewportCenter: async () => undefined,
        canvasRef: { current: null },
        activateSpace,
        navigateNode: () => undefined,
        navigateSpace: () => undefined,
      }
      const view = render(<ShortcutHarness {...props} activeSpaceId={activeSpaceId} />)
      return {
        activateSpace,
        view: (active: string | null) =>
          view.rerender(<ShortcutHarness {...props} activeSpaceId={active} />),
      }
    }

    it('activates a Space that a store write added in the same call as the key', () => {
      seedWorkspaceCanvasStore({ workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID, spaces: [] })
      const { activateSpace } = mountShortcuts(null)

      act(() => {
        replaceSpacesInStore(CANVAS_STORE_TEST_WORKSPACE_ID, [space('late')])
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: ']',
            code: 'BracketRight',
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        )
      })

      expect(activateSpace).toHaveBeenCalledExactlyOnceWith('late')
    })

    it('does not activate a Space that a store write removed in the same call as the key', () => {
      seedWorkspaceCanvasStore({
        workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
        spaces: [space('gone')],
      })
      const { activateSpace } = mountShortcuts(null)

      act(() => {
        replaceSpacesInStore(CANVAS_STORE_TEST_WORKSPACE_ID, [])
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: ']',
            code: 'BracketRight',
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        )
      })

      expect(activateSpace).not.toHaveBeenCalled()
    })

    it('keeps the order of the cycle on a fixed list: store order, top-level Spaces only', () => {
      seedWorkspaceCanvasStore({
        workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
        spaces: [
          space('s1'),
          space('child', { parentSpaceId: 's1' } as Partial<WorkspaceSpaceState>),
          space('s2'),
          space('s3'),
        ],
      })
      const { activateSpace, view } = mountShortcuts(null)

      pressBracket('BracketRight')
      expect(activateSpace).toHaveBeenLastCalledWith('s1')
      view('s1')
      pressBracket('BracketRight')
      expect(activateSpace).toHaveBeenLastCalledWith('s2')
      view('s3')
      pressBracket('BracketRight')
      expect(activateSpace).toHaveBeenLastCalledWith('s1')
      view('s1')
      pressBracket('BracketLeft')
      expect(activateSpace).toHaveBeenLastCalledWith('s3')
      view(null)
      pressBracket('BracketLeft')
      expect(activateSpace).toHaveBeenLastCalledWith('s3')
      expect(activateSpace).toHaveBeenCalledTimes(5)
    })

    it('does not subscribe the key listener again when the Spaces change', () => {
      seedWorkspaceCanvasStore({
        workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
        spaces: [space('s1')],
      })
      const add = vi.spyOn(document, 'addEventListener')
      const { view } = mountShortcuts(null)
      const keydownSubscriptions = () =>
        add.mock.calls.filter(([type]) => type === 'keydown').length
      const before = keydownSubscriptions()
      expect(before).toBeGreaterThan(0)

      act(() => {
        replaceSpacesInStore(CANVAS_STORE_TEST_WORKSPACE_ID, [space('s1'), space('s2')])
      })
      view(null)

      expect(keydownSubscriptions()).toBe(before)
    })
  })
})
