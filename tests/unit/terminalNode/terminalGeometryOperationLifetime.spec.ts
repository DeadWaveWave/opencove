import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { createRemoteGeometryAckCoordinator } from '../../../src/app/main/controlSurface/remote/remoteGeometryAckCoordinator'

function loadRendererCoordinator() {
  return import('../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator')
}

afterEach(() => {
  vi.resetModules()
})

describe('terminal geometry operation lifetime', () => {
  it('keeps a reloaded renderer request distinct from an outstanding request in Main', async () => {
    const main = createRemoteGeometryAckCoordinator()
    const beforeReload = await loadRendererCoordinator()
    const oldTerminal = {} as Terminal
    const oldRevision = beforeReload.beginTerminalGeometryCommit(oldTerminal)
    const oldRequest = beforeReload.getTerminalGeometryCommitRequest(oldTerminal, oldRevision)!
    const oldAck = main.waitForResult({
      sessionId: 'live-session',
      operationId: oldRequest.operationId,
      timeoutMs: 1_000,
      timeoutMessage: 'Old request did not settle',
    })
    vi.resetModules()
    const afterReload = await loadRendererCoordinator()
    const newTerminal = {} as Terminal
    const newRevision = afterReload.beginTerminalGeometryCommit(newTerminal)
    const newRequest = afterReload.getTerminalGeometryCommitRequest(newTerminal, newRevision)!
    const newAck = main.waitForResult({
      sessionId: 'live-session',
      operationId: newRequest.operationId,
      timeoutMs: 1_000,
      timeoutMessage: 'New request did not settle',
    })
    const outcomes = Promise.allSettled([oldAck, newAck])
    for (const [index, operationId] of [oldRequest.operationId, newRequest.operationId].entries()) {
      main.resolveResult({
        sessionId: 'live-session',
        operationId,
        status: 'accepted',
        changed: true,
        geometry: { cols: 80 + index * 20, rows: 24, revision: index + 1 },
        authority: { role: 'controller', epoch: 1 },
      })
    }
    expect(await outcomes).toMatchObject([
      { status: 'fulfilled', value: { geometry: { cols: 80 } } },
      { status: 'fulfilled', value: { geometry: { cols: 100 } } },
    ])
  })
})
