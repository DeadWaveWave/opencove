import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TerminalNodeHeader } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeHeader'

describe('TerminalNodeHeader agent status', () => {
  it('renders an honest observing state while an agent has no runtime observation', () => {
    render(<TerminalNodeHeader title="Pi" kind="agent" status={null} onClose={() => undefined} />)

    expect(screen.getByText('Observing')).toHaveClass('terminal-node__status--observing')
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
