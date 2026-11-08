import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalNodeHeader } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeHeader'

describe('TerminalNodeHeader title editing', () => {
  it('keeps the agent provider prefix fixed while editing the suffix', () => {
    const onTitleCommit = vi.fn()

    render(
      <TerminalNodeHeader
        title="codex · linked task"
        fixedTitlePrefix="codex · "
        kind="agent"
        status="running"
        onTitleCommit={onTitleCommit}
        onClose={() => undefined}
      />,
    )

    fireEvent.click(screen.getByTestId('terminal-node-title-display'))

    const input = screen.getByTestId('terminal-node-inline-title-input')
    expect(input).toHaveValue('linked task')

    fireEvent.change(input, { target: { value: 'custom summary' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onTitleCommit).toHaveBeenCalledWith('codex · custom summary')
  })

  it('commits an empty title so the placeholder can be shown', () => {
    const onTitleCommit = vi.fn()

    render(
      <TerminalNodeHeader
        title="Terminal"
        kind="terminal"
        status={null}
        onTitleCommit={onTitleCommit}
        onClose={() => undefined}
      />,
    )

    fireEvent.click(screen.getByTestId('terminal-node-title-display'))

    const input = screen.getByTestId('terminal-node-inline-title-input')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)

    expect(onTitleCommit).toHaveBeenCalledWith('')
  })

  it.each(['terminal', 'agent'] as const)(
    'makes the %s title bar the drag surface: the title moves the window, the tile only grabs',
    kind => {
      const { container } = render(
        <TerminalNodeHeader
          title="Terminal"
          kind={kind}
          status={kind === 'agent' ? 'standby' : null}
          onTitleCommit={() => undefined}
          onClose={() => undefined}
        />,
      )

      const display = screen.getByTestId('terminal-node-title-display')
      expect(display).toHaveAttribute('data-cove-title-gesture', 'move')
      expect(display).not.toHaveClass('nodrag')
      expect(container.querySelector('.cove-window-header__drag')).toBeNull()
      expect(screen.getByTestId('terminal-node-header-drag-surface')).toHaveAttribute(
        'data-cove-part',
        'kind-tile',
      )
    },
  )
})
