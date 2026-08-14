import { describe, expect, it, vi } from 'vitest'
import type { TerminalForegroundEvent } from '../../../src/shared/contracts/dto'
import { createTerminalAgentOverlayReconciliationOwner } from '../../../src/app/renderer/shell/utils/terminalAgentOverlayReconciliationOwner'

function createWorkspace(provider: 'claude-code' | 'codex' = 'codex', startedAtMs = 100) {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    worktreesRoot: '',
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    nodes: [
      {
        id: 'terminal-1',
        type: 'terminalNode',
        position: { x: 0, y: 0 },
        data: {
          kind: 'terminal',
          sessionId: 'pty-session-1',
          title: 'codex',
          executionDirectory: '/tmp/workspace',
          width: 520,
          height: 400,
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: null,
          task: null,
          note: null,
          role: null,
          image: null,
          document: null,
          website: null,
          terminalProviderHint: provider,
          terminalAgentBinding: null,
          agentOverlay: { provider, status: 'standby', startedAtMs },
        },
      },
    ],
  } as never
}

function createHarness() {
  let listener: ((event: TerminalForegroundEvent) => void) | null = null
  let workspaces = [createWorkspace()]
  const requestPersistFlush = vi.fn()
  const unsubscribe = vi.fn()
  const owner = createTerminalAgentOverlayReconciliationOwner({
    source: {
      onForeground: nextListener => {
        listener = nextListener
        return unsubscribe
      },
    },
    setWorkspaces: updater => {
      workspaces = updater(workspaces)
    },
    requestPersistFlush,
  })

  return {
    emit: (event: TerminalForegroundEvent) => listener?.(event),
    getWorkspaces: () => workspaces,
    setWorkspaces: (next: typeof workspaces) => {
      workspaces = next
    },
    requestPersistFlush,
    unsubscribe,
    owner,
  }
}

function processScan(
  observation: Pick<TerminalForegroundEvent, 'availability' | 'agent' | 'shellOnly'>,
): TerminalForegroundEvent {
  return {
    sessionId: 'pty-session-1',
    observedAtMs: 200,
    source: 'process_scan',
    exitCode: null,
    ...observation,
  }
}

describe('terminal agent overlay reconciliation owner', () => {
  it('INV-2 clears a codex overlay after an authoritative shell-only observation', () => {
    const harness = createHarness()

    harness.emit(processScan({ availability: 'available', agent: null, shellOnly: true }))

    expect(harness.getWorkspaces()[0]?.nodes[0]?.data.agentOverlay).toBeNull()
    expect(harness.getWorkspaces()[0]?.nodes[0]?.data.terminalProviderHint).toBeNull()
    expect(harness.requestPersistFlush).toHaveBeenCalledTimes(1)
  })

  it('INV-1 and INV-3 keep the overlay for unavailable and detected-agent observations', () => {
    const harness = createHarness()

    harness.emit(processScan({ availability: 'unavailable', agent: null, shellOnly: false }))
    harness.emit(processScan({ availability: 'available', agent: 'codex', shellOnly: false }))

    expect(harness.getWorkspaces()[0]?.nodes[0]?.data.agentOverlay).toMatchObject({
      provider: 'codex',
      startedAtMs: 100,
    })
    expect(harness.requestPersistFlush).not.toHaveBeenCalled()
  })

  it('does not let stale evidence or codex-only reconciliation clear another generation/provider', () => {
    const harness = createHarness()
    harness.setWorkspaces([createWorkspace('codex', 300)])

    harness.emit(processScan({ availability: 'available', agent: null, shellOnly: true }))
    expect(harness.getWorkspaces()[0]?.nodes[0]?.data.agentOverlay).not.toBeNull()

    harness.setWorkspaces([createWorkspace('claude-code', 100)])
    harness.emit(processScan({ availability: 'available', agent: null, shellOnly: true }))
    expect(harness.getWorkspaces()[0]?.nodes[0]?.data.agentOverlay).not.toBeNull()
    expect(harness.requestPersistFlush).not.toHaveBeenCalled()
  })

  it('owns and disposes its foreground subscription', () => {
    const harness = createHarness()
    harness.owner.dispose()

    expect(harness.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
