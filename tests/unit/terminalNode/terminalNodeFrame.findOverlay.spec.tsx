import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalNodeFrame } from '@/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeFrame'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))

function renderFrame(isFindOpen: boolean) {
  const props = {
    title: 'Terminal',
    kind: 'terminal' as const,
    terminalThemeMode: 'sync-with-ui' as const,
    isSelected: false,
    isDragging: false,
    status: null,
    lastError: null,
    sessionId: 'session-1',
    isTerminalHydrated: true,
    isRecoveringAgentOutput: false,
    transcriptRef: React.createRef<HTMLDivElement>(),
    sizeStyle: { width: 520, height: 360 },
    containerRef: React.createRef<HTMLDivElement>(),
    handleTerminalBodyPointerDownCapture: vi.fn(),
    handleTerminalBodyPointerMoveCapture: vi.fn(),
    handleTerminalBodyPointerUp: vi.fn(),
    consumeIgnoredTerminalBodyClick: vi.fn(() => false),
    onClose: vi.fn(),
    find: {
      isOpen: isFindOpen,
      query: 'alpha',
      resultIndex: 1,
      resultCount: 3,
      caseSensitive: false,
      useRegex: false,
    },
    onFindQueryChange: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onFindClose: vi.fn(),
    onFindToggleCaseSensitive: vi.fn(),
    onFindToggleUseRegex: vi.fn(),
    handleResizePointerDown: vi.fn(() => vi.fn()),
  }
  return { props, ...render(<TerminalNodeFrame {...props} />) }
}

describe('TerminalNodeFrame find overlay', () => {
  it('keeps Find inside an overlay body without replacing or resizing the terminal host', () => {
    const { props, container, rerender } = renderFrame(false)
    const terminalHost = container.querySelector('.terminal-node__terminal') as HTMLDivElement
    Object.defineProperty(terminalHost, 'clientHeight', { configurable: true, value: 286 })

    rerender(<TerminalNodeFrame {...props} find={{ ...props.find, isOpen: true }} />)

    const body = container.querySelector('.terminal-node__body')
    const currentTerminalHost = container.querySelector('.terminal-node__terminal')
    const findOverlay = screen.getByRole('search')
    expect(body).not.toBeNull()
    expect(currentTerminalHost).toBe(terminalHost)
    expect(currentTerminalHost?.clientHeight).toBe(286)
    expect(body).toContainElement(currentTerminalHost)
    expect(body).toContainElement(findOverlay)
    expect(findOverlay).toHaveAttribute('aria-label')
    expect(screen.getByRole('status')).toHaveTextContent('2 / 3')
  })
})
