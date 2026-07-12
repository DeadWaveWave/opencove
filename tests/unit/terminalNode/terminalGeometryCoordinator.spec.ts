import { describe, expect, it } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import {
  beginTerminalGeometryCommit,
  getTerminalGeometryCommitRequest,
  markTerminalGeometryAccepted,
  markTerminalGeometryCommitSettled,
  recordTerminalGeometryCommitResult,
  resetTerminalGeometryRevisionDomain,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator'

function createTerminal(): Terminal {
  return {} as Terminal
}

describe('terminal geometry coordinator revision domains', () => {
  it('adopts a lower authoritative revision after a Worker geometry domain is rebuilt', () => {
    const terminal = createTerminal()
    markTerminalGeometryAccepted(terminal, 9)
    const staleDomainRequest = beginTerminalGeometryCommit(terminal)
    const staleOperation = getTerminalGeometryCommitRequest(terminal, staleDomainRequest)

    expect(staleOperation?.baseGeometryRevision).toBe(9)
    expect(
      recordTerminalGeometryCommitResult(terminal, staleDomainRequest, {
        sessionId: 'session-restored',
        operationId: staleOperation!.operationId,
        status: 'superseded',
        changed: false,
        geometry: { cols: 80, rows: 24, revision: 1 },
        authority: { role: 'controller', epoch: 1 },
      }),
    ).toBe(true)
    markTerminalGeometryCommitSettled(terminal, staleDomainRequest)

    const restoredDomainRequest = beginTerminalGeometryCommit(terminal)
    expect(
      getTerminalGeometryCommitRequest(terminal, restoredDomainRequest)?.baseGeometryRevision,
    ).toBe(1)
  })

  it('resets CAS to an explicitly authoritative null revision', () => {
    const terminal = createTerminal()
    markTerminalGeometryAccepted(terminal, 9)
    resetTerminalGeometryRevisionDomain(terminal)

    const revision = beginTerminalGeometryCommit(terminal)
    expect(getTerminalGeometryCommitRequest(terminal, revision)?.baseGeometryRevision).toBeNull()
  })

  it('does not let a late baseline snapshot roll back a newer live geometry revision', () => {
    const terminal = createTerminal()
    markTerminalGeometryAccepted(terminal, 7)

    markTerminalGeometryAccepted(terminal, 2)

    const revision = beginTerminalGeometryCommit(terminal)
    expect(getTerminalGeometryCommitRequest(terminal, revision)?.baseGeometryRevision).toBe(7)
  })

  it('rejects a lower correlated revision while authority remains in the same domain', () => {
    const terminal = createTerminal()
    markTerminalGeometryAccepted(terminal, 9)
    const seedRevision = beginTerminalGeometryCommit(terminal)
    const seedOperation = getTerminalGeometryCommitRequest(terminal, seedRevision)!
    recordTerminalGeometryCommitResult(terminal, seedRevision, {
      sessionId: 'session-current',
      operationId: seedOperation.operationId,
      status: 'accepted',
      changed: false,
      geometry: { cols: 100, rows: 30, revision: 9 },
      authority: { role: 'controller', epoch: 3 },
    })
    markTerminalGeometryCommitSettled(terminal, seedRevision)
    const staleRevision = beginTerminalGeometryCommit(terminal)
    const staleOperation = getTerminalGeometryCommitRequest(terminal, staleRevision)!
    recordTerminalGeometryCommitResult(terminal, staleRevision, {
      sessionId: 'session-current',
      operationId: staleOperation.operationId,
      status: 'superseded',
      changed: false,
      geometry: { cols: 80, rows: 24, revision: 1 },
      authority: { role: 'controller', epoch: 3 },
    })
    markTerminalGeometryCommitSettled(terminal, staleRevision)

    const nextRevision = beginTerminalGeometryCommit(terminal)
    expect(getTerminalGeometryCommitRequest(terminal, nextRevision)?.baseGeometryRevision).toBe(9)
  })
})
