import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TerminalNodeHeader } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeHeader'

describe('TerminalNodeHeader directory mismatch badge', () => {
  it('renders DIR MISMATCH badge for agent nodes', () => {
    render(
      <TerminalNodeHeader
        title="codex · model"
        kind="agent"
        status="running"
        directoryMismatch={{
          executionDirectory: '/repo/.cove/worktrees/a',
          expectedDirectory: '/repo/.cove/worktrees/b',
        }}
        onClose={() => undefined}
      />,
    )

    expect(screen.getByText('DIR MISMATCH')).toBeVisible()
  })

  it('renders DIR MISMATCH badge for terminal nodes', () => {
    render(
      <TerminalNodeHeader
        title="zsh"
        kind="terminal"
        status={null}
        directoryMismatch={{
          executionDirectory: '/repo/.cove/worktrees/a',
          expectedDirectory: '/repo/.cove/worktrees/b',
        }}
        onClose={() => undefined}
      />,
    )

    expect(screen.getByText('DIR MISMATCH')).toBeVisible()
  })
})
