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
})
