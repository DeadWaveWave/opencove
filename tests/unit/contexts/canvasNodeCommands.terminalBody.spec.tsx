import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalNodeProps } from '../../../src/contexts/workspace/presentation/renderer/components/TerminalNode.types'
import type { CanvasTerminalCommands } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
import { NodeCommandsProvider, withTerminalCommands } from '../../support/nodeCommandsFixture'
import { WorkspaceCanvasTerminalNodeType } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.terminal'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

// S7 of #647, PR 5 (review round): every callback the terminal body hands TerminalNode reaches the
// terminal command it is named for, with its id and arguments, and no other command; and the
// overlay-exit callback keeps its identity while the overlay does (createRuntimeTerminalInputBridge
// compares it by identity after a Ctrl+C), whatever else of the terminal family is renewed.

vi.mock('@xyflow/react', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ nodes: [] }),
  useStoreApi: () => ({ getState: () => ({ nodes: [] }) }),
}))
const captured = vi.hoisted(() => ({ props: null as null | TerminalNodeProps }))
vi.mock('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode', () => ({
  TerminalNode: (props: TerminalNodeProps) => {
    captured.props = props
    return null
  },
}))

const base = (patch: Partial<TerminalNodeData>): TerminalNodeData => ({
  sessionId: 'pty-1',
  title: 'Terminal',
  width: 520,
  height: 400,
  kind: 'terminal',
  status: null,
  startedAt: null,
  endedAt: null,
  exitCode: null,
  lastError: null,
  scrollback: null,
  agent: null,
  task: null,
  note: null,
  image: null,
  document: null,
  website: null,
  ...patch,
})
// An agent that runs in the terminal, whose overlay the shell owns (no verified binding, no activity).
const overlay = base({
  executionDirectory: '/repo',
  agentOverlay: { provider: 'codex', status: 'standby', startedAtMs: 1234 },
})

function renderBody(data: TerminalNodeData) {
  const spies = {
    updateScrollback: vi.fn(),
    recordCommandRun: vi.fn(),
    clearAgentOverlay: vi.fn(),
    renameTitle: vi.fn(),
    copyLastAgentMessage: vi.fn(async () => undefined),
    reloadAgentSession: vi.fn(async () => undefined),
    listAgentSessions: vi.fn(async () => []),
    switchAgentSession: vi.fn(async () => undefined),
  } satisfies CanvasTerminalCommands
  render(
    <NodeCommandsProvider commands={withTerminalCommands(spies)}>
      <WorkspaceCanvasTerminalNodeType
        id="t-1"
        data={data}
        terminalFontSize={14}
        terminalFontFamily={null}
        terminalDisplayCalibration={null}
        terminalTransparentBackground={false}
      />
    </NodeCommandsProvider>,
  )
  return { spies, props: captured.props! }
}

const summary = { sessionId: 's-2', provider: 'codex' } as never
type Row = [keyof TerminalNodeProps, unknown[], keyof CanvasTerminalCommands, unknown[]]
const rows: Row[] = [
  ['onCopyLastMessage', [], 'copyLastAgentMessage', ['t-1']],
  ['onReloadSession', [], 'reloadAgentSession', ['t-1']],
  ['onListSessions', [7], 'listAgentSessions', ['t-1', 7]],
  ['onSwitchSession', [summary], 'switchAgentSession', ['t-1', summary]],
  ['onScrollbackChange', ['output'], 'updateScrollback', ['t-1', 'output']],
  ['onCommandRun', ['npm test', 5], 'recordCommandRun', ['t-1', 'npm test', 5]],
  ['onTitleCommit', ['My shell'], 'renameTitle', ['t-1', 'My shell']],
  ['onAgentOverlayExit', [], 'clearAgentOverlay', ['t-1', 1234]],
]

describe('the terminal body hands each TerminalNode callback to its terminal command', () => {
  it.each(rows)(
    '%s reaches its terminal command with the id and its arguments',
    async (prop, args, command, expected) => {
      const { spies, props } = renderBody(overlay)
      const callback = props[prop] as (...a: unknown[]) => unknown
      expect(typeof callback).toBe('function')
      await callback(...args)
      expect(spies[command]).toHaveBeenCalledTimes(1)
      expect(spies[command]).toHaveBeenCalledWith(...expected)
      for (const [name, spy] of Object.entries(spies)) {
        if (name !== command) {
          expect(spy, name).not.toHaveBeenCalled()
        }
      }
    },
  )
})

describe('the overlay-exit callback of the terminal body', () => {
  function element(commands: ReturnType<typeof withTerminalCommands>, data = overlay) {
    return (
      <NodeCommandsProvider commands={commands}>
        <WorkspaceCanvasTerminalNodeType
          id="t-1"
          data={data}
          terminalFontSize={14}
          terminalFontFamily={null}
          terminalDisplayCalibration={null}
          terminalTransparentBackground={false}
        />
      </NodeCommandsProvider>
    )
  }

  it('keeps its identity when the terminal family is renewed around the same clearAgentOverlay', () => {
    const clearAgentOverlay = vi.fn()
    const view = render(element(withTerminalCommands({ clearAgentOverlay })))
    const before = captured.props!.onAgentOverlayExit

    view.rerender(element(withTerminalCommands({ clearAgentOverlay, reloadAgentSession: vi.fn() })))

    expect(captured.props!.onAgentOverlayExit).toBe(before)
  })

  it('follows a renewed clearAgentOverlay, and the overlay it was made for', () => {
    const view = render(element(withTerminalCommands({ clearAgentOverlay: vi.fn() })))
    const before = captured.props!.onAgentOverlayExit
    const next = vi.fn()

    view.rerender(element(withTerminalCommands({ clearAgentOverlay: next })))
    captured.props!.onAgentOverlayExit!()

    expect(captured.props!.onAgentOverlayExit).not.toBe(before)
    expect(next).toHaveBeenCalledWith('t-1', 1234)
  })
})
