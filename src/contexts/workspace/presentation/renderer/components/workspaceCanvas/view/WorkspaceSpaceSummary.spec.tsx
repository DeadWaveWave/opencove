import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { WorkspaceSpaceSummary } from './WorkspaceSpaceSummary'
import { collectSpaceSummaryNodes, resolveSpaceSummaryStatus } from './spaceSummary'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function makeNode(id: string, data: Partial<TerminalNodeData> = {}): Node<TerminalNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      sessionId: `session-${id}`,
      title: id,
      width: 600,
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
      ...data,
    },
  }
}

const t = (key: string): string => key

describe('Space collapsed summary', () => {
  it('keeps every descendant window once in the existing workspace order', () => {
    const makeSpace = (id: string, parentSpaceId: string | null, nodeIds: string[]) =>
      ({
        id,
        name: id,
        parentSpaceId,
        nodeIds,
        directoryPath: '/project',
        targetMountId: null,
        labelColor: null,
        rect: null,
      }) satisfies WorkspaceSpaceState
    const spaces = [
      makeSpace('child', 'parent', ['child-window', 'shared']),
      makeSpace('parent', null, ['parent-window', 'shared']),
      makeSpace('other', null, ['other-window']),
    ]
    const nodes = ['shared', 'child-window', 'parent-window', 'other-window'].map(id =>
      makeNode(id),
    )
    expect(collectSpaceSummaryNodes('parent', spaces, nodes).map(node => node.id)).toEqual([
      'shared',
      'child-window',
      'parent-window',
    ])
  })

  it('uses the authoritative Agent observation while leaving terminal session status distinct', () => {
    const agent = makeNode('agent', {
      kind: 'agent',
      status: 'running',
      agentRuntimeObservation: {
        status: 'waiting',
        source: 'session_file',
        hookInstallState: null,
        degraded: false,
      },
    })
    expect(resolveSpaceSummaryStatus(agent.data, t)).toEqual({
      state: 'waiting',
      label: 'agentRuntime.waiting',
    })
    expect(resolveSpaceSummaryStatus(makeNode('terminal').data, t)).toEqual({
      state: 'connected',
      label: 'spaceCollapse.terminalRunning',
    })
    expect(
      resolveSpaceSummaryStatus(makeNode('exited', { endedAt: '2026-09-19T00:00:00Z' }).data, t),
    ).toEqual({
      state: 'exited',
      label: 'spaceCollapse.terminalExited',
    })
    expect(resolveSpaceSummaryStatus(makeNode('doc', { kind: 'document' }).data, t)).toBeNull()
  })

  it('retains provider branding and reveals exactly the clicked window', () => {
    const onRevealNode = vi.fn()
    const agent = makeNode('codex', {
      kind: 'agent',
      status: 'running',
      agent: {
        provider: 'codex',
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'new',
        resumeSessionId: null,
        executionDirectory: '/project',
        expectedDirectory: null,
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
    })
    const view = render(
      <WorkspaceSpaceSummary
        spaceId="parent"
        nodes={[agent, makeNode('shell')]}
        onRevealNode={onRevealNode}
      />,
    )
    const codex = screen.getByTestId('workspace-space-summary-node-codex')
    expect(codex.querySelector('[data-agent-provider="codex"]')).not.toBeNull()
    expect(within(codex).getByText('agentRuntime.working')).toBeTruthy()
    expect(
      screen.getByTestId('workspace-space-summary-node-shell').getAttribute('data-node-status'),
    ).toBe('connected')
    fireEvent.click(codex)
    expect(onRevealNode).toHaveBeenCalledWith('codex')
    view.rerender(
      <WorkspaceSpaceSummary
        spaceId="parent"
        nodes={[{ ...agent, data: { ...agent.data, status: 'standby' } }]}
        onRevealNode={onRevealNode}
      />,
    )
    expect(within(codex).getByText('agentRuntime.standby')).toBeTruthy()
  })
})
