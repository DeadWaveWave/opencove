import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivityReference } from '../utils/agentActivitySummary'
import { useAgentWaitingSinceStore } from '../hooks/useAgentWaitingSince'
import { SidebarAttentionInbox } from './SidebarAttentionInbox'

const items: AgentActivityReference[] = [
  {
    workspaceId: 'ws-core',
    projectName: 'opencove',
    projectIconId: 'terminal',
    nodeId: 'agent-flaky',
    title: 'Fix the flaky E2E',
    spaceName: null,
    provider: null,
  },
  {
    workspaceId: 'ws-site',
    projectName: 'cove-site',
    projectIconId: 'globe',
    nodeId: 'agent-notes',
    title: 'Draft the 0.5 changelog',
    spaceName: 'release-0.5',
    provider: null,
  },
]

afterEach(() => {
  vi.useRealTimers()
  useAgentWaitingSinceStore.setState({ observations: new Map() })
})

describe('SidebarAttentionInbox', () => {
  it('renders nothing while no agent is waiting', () => {
    const { container } = render(
      <SidebarAttentionInbox items={[]} onSelectAgentNode={() => undefined} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('lists waiting agents from every project with where they are and how long they waited', () => {
    vi.useFakeTimers({ now: 10 * 60_000 })
    useAgentWaitingSinceStore.setState({
      observations: new Map([
        ['agent-flaky', { status: 'waiting', waitingSinceMs: null }],
        ['agent-notes', { status: 'waiting', waitingSinceMs: 8 * 60_000 }],
      ]),
    })
    render(<SidebarAttentionInbox items={items} onSelectAgentNode={() => undefined} />)

    const inbox = screen.getByTestId('workspace-attention-inbox')
    expect(inbox.querySelector('.workspace-attention-inbox__count')?.textContent).toBe('2')
    const first = screen.getByTestId('workspace-attention-item-ws-core-agent-flaky')
    expect(first.textContent).toContain('Fix the flaky E2E')
    expect(first.textContent).toContain('opencove · Project canvas')
    expect(first.textContent).toContain('Needs your answer')
    const second = screen.getByTestId('workspace-attention-item-ws-site-agent-notes')
    expect(second.textContent).toContain('cove-site · release-0.5')
    expect(second.textContent).toContain('2 min ago')
    expect(second.getAttribute('aria-label')).toBe(
      'Draft the 0.5 changelog, cove-site · release-0.5, Needs your answer, 2 min ago',
    )
  })

  it('goes to the agent in its own project', () => {
    const onSelectAgentNode = vi.fn()
    render(<SidebarAttentionInbox items={items} onSelectAgentNode={onSelectAgentNode} />)
    fireEvent.click(screen.getByTestId('workspace-attention-item-ws-site-agent-notes'))
    expect(onSelectAgentNode).toHaveBeenCalledWith('ws-site', 'agent-notes')
  })
})
