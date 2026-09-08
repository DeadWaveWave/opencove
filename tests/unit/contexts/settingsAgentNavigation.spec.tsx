import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AgentProvider } from '../../../src/contexts/settings/domain/agentSettings'
import { useAgentSettingsNavigation } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/useAgentSettingsNavigation'

function Harness(props: { requestedProvider?: AgentProvider | null; requestKey?: number }) {
  const navigation = useAgentSettingsNavigation(props.requestedProvider, props.requestKey)
  return (
    <div className="settings-panel__content" data-testid="scroll-owner">
      <div ref={navigation.viewRef}>
        {navigation.activeProvider ? (
          <>
            <h3 tabIndex={-1} data-settings-agent-detail-heading>
              {navigation.activeProvider}
            </h3>
            <button onClick={navigation.backToList}>Back</button>
          </>
        ) : (
          <>
            <button
              data-testid="settings-agent-configure-codex"
              onClick={() => navigation.openProvider('codex')}
            >
              Codex
            </button>
            <button
              data-testid="settings-agent-configure-pi"
              onClick={() => navigation.openProvider('pi')}
            >
              Pi
            </button>
          </>
        )}
      </div>
    </div>
  )
}

describe('Agent settings detail navigation', () => {
  it('returns to the originating provider and list scroll position', () => {
    render(<Harness />)
    const content = screen.getByTestId('scroll-owner')
    content.scrollTop = 240
    fireEvent.click(screen.getByText('Codex'))
    expect(content.scrollTop).toBe(0)
    expect(screen.getByRole('heading')).toHaveFocus()
    content.scrollTop = 90
    fireEvent.click(screen.getByText('Back'))
    expect(content.scrollTop).toBe(240)
    expect(screen.getByTestId('settings-agent-configure-codex')).toHaveFocus()
  })

  it('consumes a search request once, then permits returning and opening it again with a new key', () => {
    const view = render(<Harness requestedProvider="codex" requestKey={1} />)
    expect(screen.getByRole('heading')).toHaveTextContent('codex')
    fireEvent.click(screen.getByText('Back'))
    view.rerender(<Harness requestedProvider="codex" requestKey={1} />)
    expect(screen.queryByRole('heading')).toBeNull()
    view.rerender(<Harness requestedProvider="codex" requestKey={2} />)
    expect(screen.getByRole('heading')).toHaveTextContent('codex')
    view.rerender(<Harness requestedProvider="pi" requestKey={3} />)
    expect(screen.getByRole('heading')).toHaveTextContent('pi')
    view.rerender(<Harness requestedProvider={null} requestKey={4} />)
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('preserves the hidden provider gate on external detail requests', () => {
    render(<Harness requestedProvider="gemini" requestKey={1} />)
    expect(screen.queryByRole('heading')).toBeNull()
  })
})
