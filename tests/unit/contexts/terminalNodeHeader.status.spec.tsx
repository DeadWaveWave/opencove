import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TerminalNodeHeader } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeHeader'

describe('TerminalNodeHeader agent status', () => {
  it('renders an honest observing state while an agent has no runtime observation', () => {
    render(<TerminalNodeHeader title="Pi" kind="agent" status={null} onClose={() => undefined} />)

    // Observing is not a claim of work, so it reads neutral rather than working.
    expect(screen.getByText('Observing')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.queryByText('Working')).not.toBeInTheDocument()
  })

  it('does not add an agent status to a plain terminal', () => {
    const { container } = render(
      <TerminalNodeHeader
        title="Terminal"
        kind="terminal"
        status={null}
        onClose={() => undefined}
      />,
    )

    expect(container.querySelector('.terminal-node__status')).toBeNull()
  })
})
