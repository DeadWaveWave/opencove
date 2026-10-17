import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import { AppHeaderAgentActivity } from './AppHeaderAgentActivity'

describe('AppHeaderAgentActivity', () => {
  beforeEach(async () => {
    await applyUiLanguage('en')
  })

  it('takes you to the first agent waiting for you', () => {
    const onFocusAgent = vi.fn()
    render(
      <AppHeaderAgentActivity
        summary={{
          waiting: [
            { workspaceId: 'alpha', nodeId: 'a-2', title: 'Review API' },
            { workspaceId: 'beta', nodeId: 'b-1', title: 'Fix login' },
          ],
          workingCount: 3,
        }}
        onFocusAgent={onFocusAgent}
      />,
    )
    const button = screen.getByRole('button', { name: '2 agents waiting. Go to Review API' })
    expect(button).toHaveTextContent('2 waiting')
    expect(button.querySelector('[data-cove-part="status-pill"]')).toHaveAttribute(
      'data-tone',
      'waiting',
    )
    fireEvent.click(button)
    expect(onFocusAgent).toHaveBeenCalledWith('alpha', 'a-2')
  })

  it('shows working agents as status only, and nothing when idle', () => {
    const { rerender } = render(
      <AppHeaderAgentActivity summary={{ waiting: [], workingCount: 1 }} onFocusAgent={vi.fn()} />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('1 working').closest('[data-cove-part="status-pill"]')).toHaveAttribute(
      'data-tone',
      'working',
    )
    rerender(
      <AppHeaderAgentActivity summary={{ waiting: [], workingCount: 0 }} onFocusAgent={vi.fn()} />,
    )
    expect(screen.queryByTestId('app-header-agent-activity')).toBeNull()
  })
})
