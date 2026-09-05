import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { sendPtySessionMetadata } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamWire'
import { parseBrowserPtyMetadata } from '../../../src/app/renderer/browser/BrowserPtyMetadata'
import { applyAgentMetadataToNodes } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/usePtyTaskCompletion'
import type { TerminalSessionMetadataEvent } from '../../../src/shared/contracts/dto'

const event: TerminalSessionMetadataEvent = {
  sessionId: 'pty',
  agentProvider: 'pi',
  resumeSessionId: null,
  piSnapshot: {
    version: 1,
    pid: 123,
    sequence: 5,
    conversationRevision: 2,
    sessionId: 'b',
    sessionFile: '/sessions/b.jsonl',
    persistence: 'allocated',
    state: 'standby',
  },
}

describe('Pi metadata Worker-to-Renderer route', () => {
  it('preserves native authority across websocket serialization and browser validation', () => {
    const send = vi.fn()
    sendPtySessionMetadata(
      { readyState: 1, OPEN: 1, bufferedAmount: 0, send } as unknown as WebSocket,
      event,
    )
    expect(send).toHaveBeenCalledOnce()
    const parsed = parseBrowserPtyMetadata('pty', JSON.parse(send.mock.calls[0][0]))
    expect(parsed).toEqual(event)
  })

  it('applies explicit new-session revocation through the active canvas metadata subscriber', () => {
    const nodes = [
      {
        id: 'agent',
        data: {
          kind: 'agent',
          sessionId: 'pty',
          agent: {
            provider: 'pi',
            resumeSessionId: '/sessions/a.jsonl',
            resumeSessionIdVerified: true,
          },
        },
      },
    ] as Parameters<typeof applyAgentMetadataToNodes>[0]
    const updated = applyAgentMetadataToNodes(nodes, event)
    expect(updated.didChange).toBe(true)
    expect(updated.nextNodes[0].data.agent).toMatchObject({
      resumeSessionId: null,
      resumeSessionIdVerified: false,
    })
  })
})
