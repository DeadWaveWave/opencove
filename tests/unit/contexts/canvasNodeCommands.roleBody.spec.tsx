import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasRoleCommands } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCommands'
import { WorkspaceCanvasRoleNodeType } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.role'
import type {
  RoleNodeData,
  TerminalNodeData,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  NodeCommandsProvider,
  noopNodeCommands,
  withRoleCommands,
} from '../../support/nodeCommandsFixture'

// S7 of #647, PR 6: every callback the role body hands RoleNode reaches the command it is named
// for, with its id and arguments, and no other: the three role commands, and the window commands
// of the body's frame (close, resize, select, focus). The refs they replace did the same.

vi.mock('@xyflow/react', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ nodes: [] }),
  useStoreApi: () => ({ getState: () => ({ nodes: [] }) }),
}))
type RoleNodeProps = {
  onClose: () => void
  onProviderChange: (provider: string) => void
  onInputSave: (input: string) => void
  onRun: (input: string) => void
  onResize: (frame: unknown) => void
  onInteractionStart?: (options?: {
    normalizeViewport?: boolean
    selectNode?: boolean
    shiftKey?: boolean
  }) => void
  selectedProvider: string
  providerOptions: string[]
}
const captured = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('../../../src/contexts/workspace/presentation/renderer/components/RoleNode', () => ({
  RoleNode: (props: Record<string, unknown>) => {
    captured.props = props
    return null
  },
}))

const role: RoleNodeData = {
  roleId: 'role-1',
  roleName: 'Reviewer',
  roleDescription: '',
  promptTemplate: 'Review: {{input}}',
  inputHint: '',
  outputFormat: '',
  input: 'look',
  selectedProvider: null,
  linkedAgentNodeId: null,
  runHistory: [],
  createdAt: null,
  updatedAt: null,
}
const data = {
  sessionId: '',
  title: 'Role',
  width: 400,
  height: 300,
  kind: 'role',
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
  role,
} as TerminalNodeData

function renderBody(extra: Partial<Parameters<typeof withRoleCommands>[0]> = {}) {
  const roleSpies = {
    updateInput: vi.fn(),
    updateProvider: vi.fn(),
    run: vi.fn(async () => undefined),
    ...extra,
  } satisfies CanvasRoleCommands
  const windowSpies = {
    select: vi.fn(),
    clearSelection: vi.fn(),
    close: vi.fn(async () => undefined),
    requestDelete: vi.fn(),
    resize: vi.fn(),
    focusForInteraction: vi.fn(),
    setLabelColorOverride: vi.fn(),
  }
  render(
    <NodeCommandsProvider commands={{ ...withRoleCommands(roleSpies), window: windowSpies }}>
      <WorkspaceCanvasRoleNodeType
        id="r-1"
        data={data}
        agentProviderOrder={['claude-code', 'codex']}
        defaultProvider="codex"
      />
    </NodeCommandsProvider>,
  )
  return { roleSpies, windowSpies, props: captured.props as unknown as RoleNodeProps }
}

describe('the role body hands each RoleNode callback to the command it is named for', () => {
  it('onProviderChange reaches role.updateProvider with the id and the provider, and nothing else', () => {
    const { roleSpies, windowSpies, props } = renderBody()

    props.onProviderChange('claude-code')

    expect(roleSpies.updateProvider).toHaveBeenCalledTimes(1)
    expect(roleSpies.updateProvider).toHaveBeenCalledWith('r-1', 'claude-code')
    expect(roleSpies.updateInput).not.toHaveBeenCalled()
    expect(roleSpies.run).not.toHaveBeenCalled()
    for (const spy of Object.values(windowSpies)) {
      expect(spy).not.toHaveBeenCalled()
    }
  })

  it('onInputSave reaches role.updateInput with the id and the input, and nothing else', () => {
    const { roleSpies, windowSpies, props } = renderBody()

    props.onInputSave('typed')

    expect(roleSpies.updateInput).toHaveBeenCalledTimes(1)
    expect(roleSpies.updateInput).toHaveBeenCalledWith('r-1', 'typed')
    expect(roleSpies.updateProvider).not.toHaveBeenCalled()
    expect(roleSpies.run).not.toHaveBeenCalled()
    for (const spy of Object.values(windowSpies)) {
      expect(spy).not.toHaveBeenCalled()
    }
  })

  it('onRun reaches role.run with the id and the input, and does not wait for it', () => {
    const { roleSpies, props } = renderBody()

    const result = props.onRun('go') as unknown

    expect(roleSpies.run).toHaveBeenCalledTimes(1)
    expect(roleSpies.run).toHaveBeenCalledWith('r-1', 'go')
    expect(roleSpies.updateInput).not.toHaveBeenCalled()
    expect(roleSpies.updateProvider).not.toHaveBeenCalled()
    // The callback is fire and forget, as `void runRoleRef.current(id, input)` was.
    expect(result).toBeUndefined()
  })

  it('onClose asks to delete the role window, and onResize resizes it', () => {
    const { windowSpies, roleSpies, props } = renderBody()
    const frame = { position: { x: 1, y: 2 }, size: { width: 500, height: 400 } }

    props.onClose()
    props.onResize(frame)

    expect(windowSpies.requestDelete).toHaveBeenCalledWith(['r-1'])
    expect(windowSpies.close).not.toHaveBeenCalled()
    expect(windowSpies.resize).toHaveBeenCalledWith('r-1', frame)
    expect(roleSpies.run).not.toHaveBeenCalled()
  })

  it.each([
    ['a plain click', undefined, ['select', ['r-1']], ['focusForInteraction', ['r-1']]],
    ['a shift click', { shiftKey: true }, ['select', ['r-1', { toggle: true }]], null],
    ['a press that does not select', { selectNode: false }, null, ['focusForInteraction', ['r-1']]],
    [
      'a press that does not move the viewport',
      { normalizeViewport: false },
      ['select', ['r-1']],
      null,
    ],
  ] as const)(
    'onInteractionStart on %s selects and focuses as the window commands say',
    (_name, options, select, focus) => {
      const { windowSpies, props } = renderBody()

      props.onInteractionStart!(options as never)

      if (select) {
        expect(windowSpies.select).toHaveBeenCalledTimes(1)
        expect(windowSpies.select).toHaveBeenCalledWith(...select[1])
      } else {
        expect(windowSpies.select).not.toHaveBeenCalled()
      }
      if (focus) {
        expect(windowSpies.focusForInteraction).toHaveBeenCalledWith(...focus[1])
      } else {
        expect(windowSpies.focusForInteraction).not.toHaveBeenCalled()
      }
    },
  )

  it('shows the provider of the role, or the default one, among the selectable providers', () => {
    const { props } = renderBody()

    expect(props.selectedProvider).toBe('codex')
    expect(props.providerOptions).toEqual(expect.arrayContaining(['claude-code', 'codex']))
  })

  it('renders nothing for a window that has no role data', () => {
    captured.props = null
    render(
      <NodeCommandsProvider commands={noopNodeCommands}>
        <WorkspaceCanvasRoleNodeType
          id="r-1"
          data={{ ...data, role: null } as TerminalNodeData}
          agentProviderOrder={['codex']}
          defaultProvider="codex"
        />
      </NodeCommandsProvider>,
    )

    expect(captured.props).toBeNull()
  })
})
