import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSummary } from '../../../src/shared/contracts/dto'
import {
  useWorkspaceCanvasActionRefs,
  useWorkspaceCanvasSyncActionRefs,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useActionRefs'
import { useWorkspaceCanvasAgentLastMessageCopy } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentLastMessageToNote'
import { useAgentNodeSessionControls } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeSessionControls'
import { useAgentNodeSessionSwitch } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeSessionSwitch'
import { useTerminalAgentSessionActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTerminalAgentSessionActions'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { replaceWorkspaceNodes } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  agentNode,
  sized,
  documentOf,
  nodeOf,
  renderInTwoWorkspaces,
  stubOpencoveApi,
  taskNode,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
} from '../../support/agentRuntimeHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

// The agent session controls, the session switch, the last message copy, the terminal agent
// session actions and the viewport normalisation read the committed nodes of the workspace whose
// render made them, from the store, when they run (#702, PR 10). Each case writes the store in the
// same call as the read, or shows another workspace: a read of a ref, a prop, React Flow or the
// canvas view gives another answer.
//
// The canvas store's own values keep the value of the first render, so only the document reader
// can make a callback follow the workspace shown. A reader that is missing from a dependency list,
// or frozen to the first render, then reads the first workspace after a switch. A switch moves the
// app store's active workspace too, as in the app.

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
// `t` keeps its identity, as in the app: a new one on every render would rebuild a callback that
// lists it and hide a reader that is missing from the same list.
const translation = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => translation }))

beforeEach(() => {
  firstRender.values.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the agent session controls', () => {
  // `stable` pins the reader's place in the dependency list: the writer then keeps its identity.
  function renderControls({ stable = true } = {}) {
    return renderInTwoWorkspaces(({ nodeStore, stableSetNodes }) =>
      useAgentNodeSessionControls({
        setNodes: stable ? stableSetNodes : nodeStore.setNodes,
        bumpAgentLaunchToken: nodeStore.bumpAgentLaunchToken,
      }),
    )
  }

  it('lists the sessions of an agent the store gained in the same call, in the shown workspace', async () => {
    const listSessions = vi.fn(async () => ({ sessions: [] }))
    stubOpencoveApi({ agent: { listSessions } })
    const { view, showB } = renderControls()

    await act(async () => {
      replaceWorkspaceNodes(A, [agentNode('agent-a', {}, { executionDirectory: '/dir-a' })])
      await view.result.current.listAgentSessionsForNode('agent-a')
    })
    expect(listSessions).toHaveBeenLastCalledWith({ provider: 'codex', cwd: '/dir-a', limit: 20 })

    showB()
    await act(async () => {
      replaceWorkspaceNodes(B, [agentNode('agent-b', {}, { executionDirectory: '/dir-b' })])
      await view.result.current.listAgentSessionsForNode('agent-b')
    })
    expect(listSessions).toHaveBeenLastCalledWith({ provider: 'codex', cwd: '/dir-b', limit: 20 })
    expect(listSessions).toHaveBeenCalledTimes(2)
  })

  it('lists the sessions of the workspace of the render that made the callback, not the one on display', async () => {
    const listSessions = vi.fn(async () => ({ sessions: [] }))
    stubOpencoveApi({ agent: { listSessions } })
    const { view, showB } = renderControls()
    const madeInA = view.result.current
    act(() => {
      replaceWorkspaceNodes(A, [agentNode('agent-a', {}, { executionDirectory: '/dir-a' })])
    })
    showB()

    await act(async () => {
      await madeInA.listAgentSessionsForNode('agent-a')
    })

    expect(listSessions).toHaveBeenCalledWith({ provider: 'codex', cwd: '/dir-a', limit: 20 })
  })

  it('stops an agent the store gained in the same call, and marks it stopped in its own workspace', async () => {
    const kill = vi.fn(async () => undefined)
    stubOpencoveApi({ pty: { kill } })
    const { view, showB } = renderControls({ stable: false })

    await act(async () => {
      replaceWorkspaceNodes(A, [agentNode('agent-a')])
      await view.result.current.stopAgentNode('agent-a')
    })
    expect(kill).toHaveBeenLastCalledWith({ sessionId: 'agent-a-runtime' })
    expect(nodeOf(A, 'agent-a').data.status).toBe('stopped')

    showB()
    await act(async () => {
      replaceWorkspaceNodes(B, [agentNode('agent-b')])
      await view.result.current.stopAgentNode('agent-b')
    })
    expect(kill).toHaveBeenLastCalledWith({ sessionId: 'agent-b-runtime' })
    expect(nodeOf(B, 'agent-b').data.status).toBe('stopped')
    expect(nodeOf(A, 'agent-a').data.status).toBe('stopped')
    expect(kill).toHaveBeenCalledTimes(2)
  })
})

describe('the agent session switch', () => {
  const summary = (sessionId: string, cwd: string): AgentSessionSummary => ({
    sessionId,
    provider: 'codex',
    cwd,
    title: null,
    preview: null,
    startedAt: null,
    updatedAt: null,
    source: 'codex-file',
  })

  function renderSwitch(
    relaunchAgentNode: () => Promise<undefined>,
    documents?: Parameters<typeof renderInTwoWorkspaces>[1],
    { stable = false } = {},
  ) {
    return renderInTwoWorkspaces(
      ({ nodeStore, stableSetNodes }) =>
        useAgentNodeSessionSwitch({
          setNodes: stable ? stableSetNodes : nodeStore.setNodes,
          relaunchAgentNode,
        }),
      documents,
    )
  }

  it('relaunches an agent the store gained in the same call, in the shown workspace', async () => {
    const relaunch = vi.fn(async () => undefined)
    const { view, showB } = renderSwitch(relaunch, undefined, { stable: true })

    await act(async () => {
      replaceWorkspaceNodes(A, [agentNode('agent-a')])
      await view.result.current('agent-a', summary('resume-next', '/dir-a'))
    })
    expect(relaunch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nodeId: 'agent-a',
        mode: 'resume',
        resumeSessionId: 'resume-next',
      }),
    )

    showB()
    await act(async () => {
      replaceWorkspaceNodes(B, [agentNode('agent-b')])
      await view.result.current('agent-b', summary('resume-next', '/dir-b'))
    })
    expect(relaunch).toHaveBeenLastCalledWith(
      expect.objectContaining({ nodeId: 'agent-b', executionDirectory: '/dir-b' }),
    )
    expect(relaunch).toHaveBeenCalledTimes(2)
  })

  // The relaunch lands in the store; the canvas view and its ref have not caught up yet.
  const linked = (resumeSessionId: string) =>
    agentNode('agent-1', {}, { taskId: 'task-1', resumeSessionId, executionDirectory: '/dir' })
  const landRelaunch = () =>
    vi.fn(async () => {
      replaceWorkspaceNodes(A, [linked('resume-new'), taskNode('task-1', 'agent-1')])
      return undefined
    })
  const beforeRelaunch = { a: { nodes: [linked('resume-old'), taskNode('task-1', 'agent-1')] } }

  it('judges the switch by the node the store holds after the relaunch, and records the old session on its task', async () => {
    const { view } = renderSwitch(landRelaunch(), beforeRelaunch)

    await act(async () => {
      await view.result.current('agent-1', summary('resume-new', '/dir'))
    })

    const history = nodeOf(A, 'task-1').data.task?.agentSessions ?? []
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ resumeSessionId: 'resume-old', boundDirectory: '/dir' })
  })

  it('reads the node after the relaunch from the workspace that started the switch', async () => {
    const { view, showB } = renderSwitch(landRelaunch(), beforeRelaunch)
    let pendingSwitch!: Promise<void>
    act(() => {
      pendingSwitch = view.result.current('agent-1', summary('resume-new', '/dir'))
    })
    showB()
    await act(async () => {
      await pendingSwitch
    })

    expect(nodeOf(A, 'task-1').data.task?.agentSessions).toHaveLength(1)
    expect(documentOf(B).nodes).toEqual([])
  })
})

describe('the last message copy', () => {
  it('copies the message of an agent the store gained in the same call, in the shown workspace', async () => {
    const readLastMessage = vi.fn(async () => ({ message: 'Done.' }))
    const writeText = vi.fn(async () => undefined)
    stubOpencoveApi({ agent: { readLastMessage }, clipboard: { writeText } })
    const onShowMessage = vi.fn()
    const { view, showB } = renderInTwoWorkspaces(() =>
      useWorkspaceCanvasAgentLastMessageCopy({ onShowMessage }),
    )

    await act(async () => {
      replaceWorkspaceNodes(A, [agentNode('agent-a', {}, { executionDirectory: '/dir-a' })])
      await view.result.current('agent-a')
    })
    expect(readLastMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'agent-a-runtime', cwd: '/dir-a' }),
    )

    showB()
    await act(async () => {
      replaceWorkspaceNodes(B, [agentNode('agent-b', {}, { executionDirectory: '/dir-b' })])
      await view.result.current('agent-b')
    })
    expect(readLastMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 'agent-b-runtime', cwd: '/dir-b' }),
    )
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(onShowMessage).toHaveBeenCalledWith('messages.agentLastMessageCopied')
  })

  it('copies the message of the workspace of the render that made the callback, not the one on display', async () => {
    const readLastMessage = vi.fn(async () => ({ message: 'Done.' }))
    stubOpencoveApi({
      agent: { readLastMessage },
      clipboard: { writeText: vi.fn(async () => undefined) },
    })
    const { view, showB } = renderInTwoWorkspaces(
      () => useWorkspaceCanvasAgentLastMessageCopy({ onShowMessage: vi.fn() }),
      { a: { nodes: [agentNode('agent-a', {}, { executionDirectory: '/dir-a' })] } },
    )
    const madeInA = view.result.current
    showB()

    await act(async () => {
      await madeInA('agent-a')
    })

    expect(readLastMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'agent-a-runtime', cwd: '/dir-a' }),
    )
  })

  it('warns when the store does not hold the node', async () => {
    stubOpencoveApi({ agent: { readLastMessage: vi.fn() } })
    const onShowMessage = vi.fn()
    const { view } = renderInTwoWorkspaces(() =>
      useWorkspaceCanvasAgentLastMessageCopy({ onShowMessage }),
    )

    await act(async () => {
      await view.result.current('agent-a')
    })

    expect(onShowMessage).toHaveBeenLastCalledWith(
      'messages.agentLastMessageUnavailable',
      'warning',
    )
    expect(window.opencoveApi.agent.readLastMessage).not.toHaveBeenCalled()
  })
})

describe('the terminal agent session actions', () => {
  const overlayNode = (id: string, sessionId: string): Node<TerminalNodeData> =>
    sized({
      ...pixelNode({
        kind: 'terminal',
        sessionId,
        executionDirectory: `/tmp/${id}`,
        terminalAgentBinding: {
          provider: 'codex',
          resumeSessionId: 'resume-current',
          resumeSessionIdVerified: true,
        },
        agentOverlay: {
          provider: 'codex',
          status: 'standby',
          startedAtMs: Date.parse('2026-08-12T00:00:00.000Z'),
        },
      }),
      id,
    })

  it('reloads a terminal the store gained in the same call, in the shown workspace', async () => {
    const reexecAgent = vi.fn(async (input: { sessionId: string }) => ({
      sessionId: input.sessionId,
      operationId: 'operation-1',
      status: 'reexecuted' as const,
    }))
    stubOpencoveApi({ pty: { reexecAgent }, agent: { listSessions: vi.fn() } })
    const { view, showB } = renderInTwoWorkspaces(({ stableSetNodes }) =>
      useTerminalAgentSessionActions({ setNodes: stableSetNodes }),
    )

    await act(async () => {
      replaceWorkspaceNodes(A, [overlayNode('terminal-a', 'pty-a')])
      await view.result.current.reloadOverlayAgent('terminal-a')
    })
    expect(reexecAgent).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 'pty-a' }))

    showB()
    await act(async () => {
      replaceWorkspaceNodes(B, [overlayNode('terminal-b', 'pty-b')])
      await view.result.current.reloadOverlayAgent('terminal-b')
    })
    expect(reexecAgent).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 'pty-b' }))
    expect(reexecAgent).toHaveBeenCalledTimes(2)
  })

  it('lists the sessions of a terminal the store gained in the same call, in the shown workspace', async () => {
    const listSessions = vi.fn(async () => ({ provider: 'codex', cwd: '', sessions: [] }))
    stubOpencoveApi({ agent: { listSessions } })
    const { view, showB } = renderInTwoWorkspaces(({ stableSetNodes }) =>
      useTerminalAgentSessionActions({ setNodes: stableSetNodes }),
    )

    let sessions: unknown
    await act(async () => {
      replaceWorkspaceNodes(A, [overlayNode('terminal-a', 'pty-a')])
      sessions = await view.result.current.listOverlayAgentSessions('terminal-a')
    })
    expect(sessions).toEqual([])
    expect(listSessions).toHaveBeenLastCalledWith({
      provider: 'codex',
      cwd: '/tmp/terminal-a',
      limit: 20,
    })

    showB()
    await act(async () => {
      replaceWorkspaceNodes(B, [overlayNode('terminal-b', 'pty-b')])
      await view.result.current.listOverlayAgentSessions('terminal-b')
    })
    expect(listSessions).toHaveBeenLastCalledWith({
      provider: 'codex',
      cwd: '/tmp/terminal-b',
      limit: 20,
    })
    expect(listSessions).toHaveBeenCalledTimes(2)
  })

  it('switches the session of a terminal the store gained in the same call', async () => {
    const reexecAgent = vi.fn(
      async (input: { sessionId: string; resumeSessionId: string | null }) => ({
        sessionId: input.sessionId,
        operationId: 'operation-1',
        status: 'reexecuted' as const,
      }),
    )
    stubOpencoveApi({ pty: { reexecAgent } })
    const { view } = renderInTwoWorkspaces(({ stableSetNodes }) =>
      useTerminalAgentSessionActions({ setNodes: stableSetNodes }),
    )

    let handled = false
    await act(async () => {
      replaceWorkspaceNodes(A, [overlayNode('terminal-a', 'pty-a')])
      handled = await view.result.current.switchOverlayAgentSession('terminal-a', {
        sessionId: 'resume-next',
        provider: 'codex',
        cwd: '/tmp/terminal-a',
        title: null,
        preview: null,
        startedAt: null,
        updatedAt: null,
        source: 'codex-file',
      })
    })

    expect(handled).toBe(true)
    expect(reexecAgent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'pty-a', resumeSessionId: 'resume-next' }),
    )
  })
})

const noopCallback = vi.fn()

function renderViewportRefs(
  setCenter: () => void,
  documents?: Parameters<typeof renderInTwoWorkspaces>[1],
) {
  // React Flow's instance keeps its identity, as in the app, so that only the reader can rebuild
  // the viewport callback on a switch.
  const reactFlow = { setCenter } as never
  return renderInTwoWorkspaces(() => {
    const actionRefs = useWorkspaceCanvasActionRefs()
    useWorkspaceCanvasSyncActionRefs({
      actionRefs,
      clearNodeSelection: noopCallback,
      closeNode: noopCallback,
      resizeNode: noopCallback,
      copyAgentLastMessage: noopCallback,
      reloadAgentSession: noopCallback,
      listAgentSessions: noopCallback,
      switchAgentSession: noopCallback,
      updateNoteText: noopCallback,
      renameNoteTitle: noopCallback,
      updateWebsiteUrl: noopCallback,
      setWebsitePinned: noopCallback,
      setWebsiteSession: noopCallback,
      setWebsiteMode: noopCallback,
      setWebsiteFullscreen: noopCallback,
      updateNodeScrollback: noopCallback,
      updateTerminalTitle: noopCallback,
      clearTerminalAgentOverlay: noopCallback,
      renameTerminalTitle: noopCallback,
      focusNodeOnClick: true,
      focusNodeTargetZoom: 1,
      reactFlow,
    } as never)
    return actionRefs
  }, documents)
}

describe('the viewport normalisation of a terminal interaction', () => {
  const at = (x: number, y: number) => ({ ...agentNode('agent'), position: { x, y } })

  it('centres on a node the store gained in the same call, in the shown workspace', () => {
    const setCenter = vi.fn()
    const { view, showB } = renderViewportRefs(setCenter)

    act(() => {
      replaceWorkspaceNodes(A, [at(100, 200)])
      view.result.current.normalizeViewportForTerminalInteractionRef.current('agent')
    })
    expect(setCenter).toHaveBeenLastCalledWith(100 + 260, 200 + 180, expect.anything())

    showB()
    act(() => {
      replaceWorkspaceNodes(B, [at(1000, 2000)])
      view.result.current.normalizeViewportForTerminalInteractionRef.current('agent')
    })
    expect(setCenter).toHaveBeenLastCalledWith(1000 + 260, 2000 + 180, expect.anything())
    expect(setCenter).toHaveBeenCalledTimes(2)
  })

  it('centres on a node of its own workspace while another is displayed', () => {
    const setCenter = vi.fn()
    const { view } = renderViewportRefs(setCenter, { a: { nodes: [at(100, 200)] } })
    act(() => useAppStore.setState({ activeWorkspaceId: B }))

    act(() => {
      view.result.current.normalizeViewportForTerminalInteractionRef.current('agent')
    })

    expect(setCenter).toHaveBeenCalledWith(100 + 260, 200 + 180, expect.anything())
  })
})

// The reader belongs to the workspace of the render, not to the one on display: here the app
// store shows B while every hook is rendered under A, and each still reads A.
describe('a render of workspace A while workspace B is displayed', () => {
  const displayB = () => act(() => useAppStore.setState({ activeWorkspaceId: B }))
  const inA = { a: { nodes: [agentNode('agent-a', {}, { executionDirectory: '/dir-a' })] } }

  it('lists the sessions of an agent of A', async () => {
    const listSessions = vi.fn(async () => ({ sessions: [] }))
    stubOpencoveApi({ agent: { listSessions } })
    const { view } = renderInTwoWorkspaces(
      ({ nodeStore, stableSetNodes }) =>
        useAgentNodeSessionControls({
          setNodes: stableSetNodes,
          bumpAgentLaunchToken: nodeStore.bumpAgentLaunchToken,
        }),
      inA,
    )
    displayB()

    await act(async () => {
      await view.result.current.listAgentSessionsForNode('agent-a')
    })

    expect(listSessions).toHaveBeenCalledWith({ provider: 'codex', cwd: '/dir-a', limit: 20 })
  })

  it('relaunches an agent of A through the session switch', async () => {
    const relaunch = vi.fn(async () => undefined)
    const { view } = renderInTwoWorkspaces(
      ({ stableSetNodes }) =>
        useAgentNodeSessionSwitch({ setNodes: stableSetNodes, relaunchAgentNode: relaunch }),
      inA,
    )
    displayB()

    await act(async () => {
      await view.result.current('agent-a', {
        sessionId: 'resume-next',
        provider: 'codex',
        cwd: '/dir-a',
        title: null,
        preview: null,
        startedAt: null,
        updatedAt: null,
        source: 'codex-file',
      })
    })

    expect(relaunch).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'agent-a' }))
  })

  it('copies the last message of an agent of A', async () => {
    const readLastMessage = vi.fn(async () => ({ message: 'Done.' }))
    stubOpencoveApi({
      agent: { readLastMessage },
      clipboard: { writeText: vi.fn(async () => undefined) },
    })
    const { view } = renderInTwoWorkspaces(
      () => useWorkspaceCanvasAgentLastMessageCopy({ onShowMessage: vi.fn() }),
      inA,
    )
    displayB()

    await act(async () => {
      await view.result.current('agent-a')
    })

    expect(readLastMessage).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/dir-a' }))
  })

  it('lists the sessions of a terminal of A', async () => {
    const listSessions = vi.fn(async () => ({ provider: 'codex', cwd: '', sessions: [] }))
    stubOpencoveApi({ agent: { listSessions } })
    const { view } = renderInTwoWorkspaces(
      ({ stableSetNodes }) => useTerminalAgentSessionActions({ setNodes: stableSetNodes }),
      {
        a: {
          nodes: [
            sized({
              ...pixelNode({
                kind: 'terminal',
                executionDirectory: '/dir-a',
                agentOverlay: {
                  provider: 'codex',
                  status: 'standby',
                  startedAtMs: Date.parse('2026-08-12T00:00:00.000Z'),
                },
              }),
              id: 'terminal-a',
            }),
          ],
        },
      },
    )
    displayB()

    await act(async () => {
      await view.result.current.listOverlayAgentSessions('terminal-a')
    })

    expect(listSessions).toHaveBeenCalledWith({ provider: 'codex', cwd: '/dir-a', limit: 20 })
  })
})
