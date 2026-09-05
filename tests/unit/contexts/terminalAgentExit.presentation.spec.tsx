import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AGENT_PROVIDER_IDS } from '../../../src/shared/contracts/dto'
import { WorkspaceCanvasTerminalNodeType } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.terminal'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { buildSidebarAgentItems } from '../../../src/app/renderer/shell/utils/sidebarAgents'
import { updateWorkspacesWithTerminalAgentActivityMetadata } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync.terminalAgentActivity'
import { updateWorkspacesWithAgentExit } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync'
import { createTerminalAgentWorkspace, invocationEvent } from './terminalAgentExit.testSupport'
import { installTerminalThemePtyApiMock } from './terminalNode.theme.testHarness'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  useStore: (selector: (state: unknown) => unknown) => selector({ nodes: [] }),
  useStoreApi: () => ({ getState: () => ({ nodes: [] }) }),
}))

// Exercise the actual node, frame and header. Only the xterm/PTY effect is excluded.
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession',
  () => ({
    useTerminalRuntimeSession: () => undefined,
  }),
)

function renderNode(data: TerminalNodeData) {
  installTerminalThemePtyApiMock()
  const reload = vi.fn(async () => undefined)
  const element = (nextData: TerminalNodeData) => (
    <WorkspaceCanvasTerminalNodeType
      id="terminal-1"
      data={nextData}
      terminalFontSize={14}
      terminalFontFamily={null}
      terminalDisplayCalibration={null}
      selectNode={vi.fn()}
      closeNodeRef={{ current: vi.fn(async () => undefined) }}
      resizeNodeRef={{ current: vi.fn() }}
      copyAgentLastMessageRef={{ current: vi.fn(async () => undefined) }}
      reloadAgentSessionRef={{ current: reload }}
      listAgentSessionsRef={{ current: vi.fn(async () => []) }}
      switchAgentSessionRef={{ current: vi.fn(async () => undefined) }}
      updateNodeScrollbackRef={{ current: vi.fn() }}
      normalizeViewportForTerminalInteractionRef={{ current: vi.fn() }}
      updateTerminalTitleRef={{ current: vi.fn() }}
      clearTerminalAgentOverlayRef={{ current: vi.fn() }}
      renameTerminalTitleRef={{ current: vi.fn() }}
    />
  )
  const view = render(element(data))
  return { ...view, reload, update: (next: TerminalNodeData) => view.rerender(element(next)) }
}

function expectActions(visible: boolean) {
  for (const action of ['copy-last-message', 'reload-session', 'session-list']) {
    const button = screen.queryByTestId(`terminal-node-${action}`)
    if (visible) {
      expect(button).toBeVisible()
    } else {
      expect(button).toBeNull()
    }
  }
}

describe.each(['codex', 'claude-code'] as const)(
  '%s terminal Agent exit presentation',
  provider => {
    it.each([false, true])('converges frame/actions/sidebar on exit (verified=%s)', verified => {
      const workspace = createTerminalAgentWorkspace(provider, verified)
      const view = renderNode(workspace.nodes[0].data)
      expect(view.container.querySelector('.terminal-node__status')).toHaveTextContent('Working')
      expectActions(true)
      expect(buildSidebarAgentItems(workspace)[0]?.status).toBe('working')

      const result = updateWorkspacesWithTerminalAgentActivityMetadata({
        workspaces: [workspace],
        event: invocationEvent(provider, 'exited'),
      })
      const exited = result.nextWorkspaces[0]
      view.update(exited.nodes[0].data)

      expectActions(verified)
      if (verified) {
        expect(view.container.querySelector('.terminal-node__status')).toHaveTextContent('Standby')
        expect(buildSidebarAgentItems(exited)[0]?.status).toBe('standby')
        fireEvent.click(screen.getByTestId('terminal-node-reload-session'))
        expect(view.reload).toHaveBeenCalledWith('terminal-1')
      } else {
        expect(view.container.querySelector('.terminal-node__status')).toBeNull()
        expect(buildSidebarAgentItems(exited)).toEqual([])
      }
      expect(exited.nodes[0].data.terminalAgentBinding).toEqual(
        workspace.nodes[0].data.terminalAgentBinding,
      )
      expect(exited.nodes[0].data).toMatchObject({
        kind: 'terminal',
        sessionId: 'pty-1',
        scrollback: 'preserved output',
        agentOverlay: { activity: { phase: 'exited', generation: 1 } },
      })
    })

    it('renders the same bound exit even with a stale observation in a reattached projection', () => {
      const workspace = createTerminalAgentWorkspace(provider, true)
      workspace.nodes[0].data.agentOverlay!.activity!.phase = 'exited'
      const view = renderNode(workspace.nodes[0].data)
      expect(view.container.querySelector('.terminal-node__status')).toHaveTextContent('Standby')
      expect(buildSidebarAgentItems(workspace)[0]?.status).toBe('standby')
      expectActions(true)
    })
  },
)

describe.each(AGENT_PROVIDER_IDS)('%s dedicated Agent exit presentation', provider => {
  it.each([0, 1])(
    'gives PTY exit precedence over the last working observation (code=%s)',
    exitCode => {
      const workspace = createTerminalAgentWorkspace()
      const data = workspace.nodes[0].data
      data.kind = 'agent'
      data.status = 'running'
      data.agentOverlay = null
      data.agent = {
        provider,
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'new',
        resumeSessionId: null,
        executionDirectory: '/tmp/workspace',
        expectedDirectory: '/tmp/workspace',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      }
      const view = renderNode(data)
      expect(view.container.querySelector('.terminal-node__status')).toHaveTextContent('Working')
      const result = updateWorkspacesWithAgentExit({
        workspaces: [workspace],
        sessionId: 'pty-1',
        exitCode,
        now: '2026-09-05T00:00:00Z',
      })
      view.update(result.nextWorkspaces[0].nodes[0].data)
      expect(view.container.querySelector('.terminal-node__status')).toHaveTextContent(
        exitCode === 0 ? 'Exited' : 'Failed',
      )
      expect(buildSidebarAgentItems(result.nextWorkspaces[0])[0]?.status).toBe('standby')
      expect(screen.getByTestId('terminal-node-reload-session')).toBeVisible()
    },
  )
})
