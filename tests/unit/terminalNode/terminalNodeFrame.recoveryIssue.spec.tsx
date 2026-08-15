import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalNodeFrame } from '@/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeFrame'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))

describe('TerminalNodeFrame recovery issue', () => {
  it('presents an actionable transient writer-lock message for an agent node', () => {
    const onReloadSession = vi.fn(async () => undefined)
    render(
      <TerminalNodeFrame
        title="Agent"
        kind="agent"
        isSelected={false}
        isDragging={false}
        status="standby"
        agentStateSource={null}
        agentHookInstallState={null}
        agentStateDegraded={false}
        lastError={null}
        recoveryIssue="codex_writer_locked"
        sessionId="fallback-shell"
        isTerminalHydrated={true}
        transcriptRef={React.createRef<HTMLDivElement>()}
        sizeStyle={{ width: 520, height: 360 }}
        containerRef={React.createRef<HTMLDivElement>()}
        handleTerminalBodyPointerDownCapture={vi.fn()}
        handleTerminalBodyPointerMoveCapture={vi.fn()}
        handleTerminalBodyPointerUp={vi.fn()}
        consumeIgnoredTerminalBodyClick={vi.fn(() => false)}
        onClose={vi.fn()}
        onReloadSession={onReloadSession}
        find={{
          isOpen: false,
          query: '',
          resultIndex: -1,
          resultCount: 0,
          caseSensitive: false,
          useRegex: false,
        }}
        onFindQueryChange={vi.fn()}
        onFindNext={vi.fn()}
        onFindPrevious={vi.fn()}
        onFindClose={vi.fn()}
        onFindToggleCaseSensitive={vi.fn()}
        onFindToggleUseRegex={vi.fn()}
        handleResizePointerDown={vi.fn(() => vi.fn())}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/another writer|另一个写入进程/i)
    fireEvent.click(screen.getByRole('button', { name: /retry|重试/i }))
    expect(onReloadSession).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Agent resume failed')).not.toBeInTheDocument()
  })

  it('presents the unresolved original worker without rewriting a terminal node', () => {
    render(
      <TerminalNodeFrame
        title="Remote terminal"
        kind="terminal"
        isSelected={false}
        isDragging={false}
        status={null}
        agentStateSource={null}
        agentHookInstallState={null}
        agentStateDegraded={false}
        lastError={null}
        recoveryIssue="remote_worker_unavailable"
        sessionId=""
        isTerminalHydrated={false}
        transcriptRef={React.createRef<HTMLDivElement>()}
        sizeStyle={{ width: 520, height: 360 }}
        containerRef={React.createRef<HTMLDivElement>()}
        handleTerminalBodyPointerDownCapture={vi.fn()}
        handleTerminalBodyPointerMoveCapture={vi.fn()}
        handleTerminalBodyPointerUp={vi.fn()}
        consumeIgnoredTerminalBodyClick={vi.fn(() => false)}
        onClose={vi.fn()}
        find={{
          isOpen: false,
          query: '',
          resultIndex: -1,
          resultCount: 0,
          caseSensitive: false,
          useRegex: false,
        }}
        onFindQueryChange={vi.fn()}
        onFindNext={vi.fn()}
        onFindPrevious={vi.fn()}
        onFindClose={vi.fn()}
        onFindToggleCaseSensitive={vi.fn()}
        onFindToggleUseRegex={vi.fn()}
        handleResizePointerDown={vi.fn(() => vi.fn())}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/original remote worker|原远程 Worker/i)
    expect(screen.queryByRole('button', { name: /retry|重试/i })).not.toBeInTheDocument()
  })
})
