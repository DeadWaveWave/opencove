import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { useWorkspaceCanvasAgentLauncher } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentLauncher'
import { assignNodeToSpaceAndExpand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'
import {
  launchWorkspaceAgentSession,
  resolveWorkspaceAgentLaunchBinding,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'

// The agent launcher reads the Space under the launch anchor from the committed document of the
// workspace whose render made its callback, and flushes once after assigning the node to it (#702,
// PR 10). The canvas store's own values keep the value of the first render, so only the document
// reader can make the callback follow the workspace shown: a reader that is frozen to the first
// render, or missing from the dependency list, finds workspace A's Space after a switch.

const firstRender = vi.hoisted(() => ({ values: new Map<string, unknown>() }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext',
  async importOriginal => {
    const original = await importOriginal<Record<string, () => unknown>>()
    const stable = (name: string) => () => {
      const real = original[name]()
      if (!firstRender.values.has(name)) {
        firstRender.values.set(name, real)
      }
      return firstRender.values.get(name)
    }
    return {
      ...original,
      useCanvasUiCommands: stable('useCanvasUiCommands'),
      useCanvasSelectionCommands: stable('useCanvasSelectionCommands'),
      useCanvasDocumentCommands: stable('useCanvasDocumentCommands'),
      useReadCanvasUi: stable('useReadCanvasUi'),
      useReadCanvasSelection: stable('useReadCanvasSelection'),
    }
  },
)
const translation = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => translation }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared',
  () => ({
    buildMergedAgentLaunchEnv: vi.fn(() => ({})),
    resolveAgentExecutableOverride: vi.fn(() => undefined),
    resolveWorkspaceAgentLaunchBinding: vi.fn(async () => ({
      mountId: null,
      executionDirectory: '/repo',
    })),
    launchWorkspaceAgentSession: vi.fn(async () => ({
      sessionId: 'session-1',
      resumeSessionId: null,
      profileId: null,
      runtimeKind: 'posix',
      effectiveModel: null,
      executionDirectory: '/repo',
      workerBinding: { endpointId: 'local', mountId: null },
    })),
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    assignNodeToSpaceAndExpand: vi.fn(),
  }),
)

const A = 'workspace-a'
const B = 'workspace-b'

const spaceIn = (id: string): WorkspaceSpaceState => ({
  id,
  name: id,
  directoryPath: '/repo',
  targetMountId: null,
  labelColor: null,
  nodeIds: [],
  rect: { x: 0, y: 0, width: 1000, height: 900 },
})

// Arguments are built once, as the canvas's are, so that the callback is rebuilt only when a
// dependency of its own changes.
const params = {
  agentSettings: { ...DEFAULT_AGENT_SETTINGS, defaultProvider: 'codex' as const },
  workspaceId: 'project',
  workspacePath: '/repo',
  updateCanvasDocument: vi.fn(),
  onShowMessage: vi.fn(),
  createNodeForSession: vi.fn(
    async (input: { nodeId: string; anchor: { x: number; y: number } }) => ({
      id: input.nodeId,
      position: input.anchor,
      data: { kind: 'agent' },
    }),
  ),
  standardWindowSizeBucket: DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
  buildAgentNodeTitle: vi.fn(() => 'Agent'),
} as unknown as Parameters<typeof useWorkspaceCanvasAgentLauncher>[0]

function renderLauncher() {
  const harness = createCanvasDocumentHarness({ workspaceId: A, spaces: [spaceIn('space-a')] })
  useAppStore.setState(state => ({
    workspaces: [
      ...state.workspaces,
      { ...state.workspaces[0], id: B, spaces: [spaceIn('space-b')] },
    ],
  }))
  let shown = A
  const view = renderInCanvasDocument(() => useWorkspaceCanvasAgentLauncher(params), {
    workspaceId: () => shown,
  })
  return {
    harness,
    view,
    showB: () =>
      act(() => {
        shown = B
        useAppStore.setState({ activeWorkspaceId: B })
        view.rerender()
      }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  firstRender.values.clear()
})

describe('the agent launcher in two workspaces', () => {
  it('launches into the Space under the anchor of the shown workspace, whichever came first', async () => {
    const { view, showB } = renderLauncher()

    await act(async () => {
      await view.result.current.launchAgentAtFlowPosition({ x: 400, y: 300 })
    })
    expect(resolveWorkspaceAgentLaunchBinding).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetSpace: expect.objectContaining({ id: 'space-a' }) }),
    )

    showB()
    await act(async () => {
      await view.result.current.launchAgentAtFlowPosition({ x: 400, y: 300 })
    })
    expect(resolveWorkspaceAgentLaunchBinding).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetSpace: expect.objectContaining({ id: 'space-b' }) }),
    )
    expect(launchWorkspaceAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ spaceId: 'space-b' }),
    )
  })

  it('flushes once for each launch into a Space, after the assignment', async () => {
    const { view, showB, harness } = renderLauncher()
    const order: string[] = []
    vi.mocked(assignNodeToSpaceAndExpand).mockImplementation(() => {
      order.push('assign')
    })
    harness.flush.mockImplementation(() => {
      order.push('flush')
    })

    await act(async () => {
      await view.result.current.launchAgentAtFlowPosition({ x: 400, y: 300 })
    })
    showB()
    await act(async () => {
      await view.result.current.launchAgentAtFlowPosition({ x: 400, y: 300 })
    })

    expect(order).toEqual(['assign', 'flush', 'assign', 'flush'])
  })
})
