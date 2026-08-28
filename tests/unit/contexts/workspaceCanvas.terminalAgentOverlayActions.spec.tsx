import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalNodeProps } from '../../../src/contexts/workspace/presentation/renderer/components/TerminalNode.types'
import { WorkspaceCanvasTerminalNodeType } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.terminal'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

vi.mock('@xyflow/react', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ nodes: [] }),
  useStoreApi: () => ({ getState: () => ({ nodes: [] }) }),
}))

vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode', () => ({
  TerminalNode: (props: TerminalNodeProps) => (
    <div>
      <span data-testid="copy">{String(typeof props.onCopyLastMessage === 'function')}</span>
      <span data-testid="reload">{String(typeof props.onReloadSession === 'function')}</span>
      <span data-testid="list">{String(typeof props.onListSessions === 'function')}</span>
      <span data-testid="switch">{String(typeof props.onSwitchSession === 'function')}</span>
      <span data-testid="cwd">{props.agentExecutionDirectory}</span>
      <span data-testid="resume">{props.agentResumeSessionId}</span>
      <button data-testid="exit" onClick={props.onAgentOverlayExit} />
    </div>
  ),
}))

function createOverlayData(): TerminalNodeData {
  return {
    sessionId: 'pty-session-1',
    title: 'Terminal',
    width: 520,
    height: 400,
    kind: 'terminal',
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: 'preserved scrollback',
    executionDirectory: '/tmp/overlay cwd',
    terminalAgentBinding: {
      provider: 'codex',
      resumeSessionId: 'resume-overlay',
      resumeSessionIdVerified: true,
    },
    agentOverlay: {
      provider: 'codex',
      status: 'standby',
      startedAtMs: Date.parse('2026-08-12T00:00:00.000Z'),
    },
    agent: null,
    task: null,
    note: null,
    image: null,
    document: null,
    website: null,
  }
}

describe('WorkspaceCanvas terminal agent overlay actions', () => {
  it('wires all four agent actions from the overlay and terminal binding', () => {
    const noop = vi.fn()
    render(
      <WorkspaceCanvasTerminalNodeType
        id="terminal-1"
        data={createOverlayData()}
        terminalFontSize={14}
        terminalFontFamily={null}
        terminalDisplayCalibration={null}
        selectNode={noop}
        closeNodeRef={{ current: vi.fn(async () => undefined) }}
        resizeNodeRef={{ current: noop }}
        copyAgentLastMessageRef={{ current: vi.fn(async () => undefined) }}
        reloadAgentSessionRef={{ current: vi.fn(async () => undefined) }}
        listAgentSessionsRef={{ current: vi.fn(async () => []) }}
        switchAgentSessionRef={{ current: vi.fn(async () => undefined) }}
        updateNodeScrollbackRef={{ current: noop }}
        normalizeViewportForTerminalInteractionRef={{ current: noop }}
        updateTerminalTitleRef={{ current: noop }}
        clearTerminalAgentOverlayRef={{ current: noop }}
        renameTerminalTitleRef={{ current: noop }}
      />,
    )

    expect(screen.getByTestId('copy')).toHaveTextContent('true')
    expect(screen.getByTestId('reload')).toHaveTextContent('true')
    expect(screen.getByTestId('list')).toHaveTextContent('true')
    expect(screen.getByTestId('switch')).toHaveTextContent('true')
    expect(screen.getByTestId('cwd')).toHaveTextContent('/tmp/overlay cwd')
    expect(screen.getByTestId('resume')).toHaveTextContent('resume-overlay')
  })

  it('leaves a gateway-owned invocation for authoritative exit reconciliation', () => {
    const clearTerminalAgentOverlay = vi.fn()
    const data = createOverlayData()
    data.agentOverlay!.activity = {
      invocationId: 'invocation-1',
      generation: 1,
      phase: 'active',
      observedAtMs: 100,
    }

    render(
      <WorkspaceCanvasTerminalNodeType
        id="terminal-1"
        data={data}
        terminalFontSize={14}
        terminalFontFamily={null}
        terminalDisplayCalibration={null}
        selectNode={vi.fn()}
        closeNodeRef={{ current: vi.fn(async () => undefined) }}
        resizeNodeRef={{ current: vi.fn() }}
        copyAgentLastMessageRef={{ current: vi.fn(async () => undefined) }}
        reloadAgentSessionRef={{ current: vi.fn(async () => undefined) }}
        listAgentSessionsRef={{ current: vi.fn(async () => []) }}
        switchAgentSessionRef={{ current: vi.fn(async () => undefined) }}
        updateNodeScrollbackRef={{ current: vi.fn() }}
        normalizeViewportForTerminalInteractionRef={{ current: vi.fn() }}
        updateTerminalTitleRef={{ current: vi.fn() }}
        clearTerminalAgentOverlayRef={{ current: clearTerminalAgentOverlay }}
        renameTerminalTitleRef={{ current: vi.fn() }}
      />,
    )

    fireEvent.click(screen.getByTestId('exit'))

    expect(clearTerminalAgentOverlay).not.toHaveBeenCalled()
  })
})
