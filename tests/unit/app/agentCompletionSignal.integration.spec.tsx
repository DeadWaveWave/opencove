import React from 'react'
import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { createPtyEventHub } from '../../../src/app/renderer/shell/utils/ptyEventHub'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { createClaudeHookChannel } from '../../../src/app/main/controlSurface/agentHook/claudeHookChannel'
import { WorkspaceWindowSignals } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals'
import { subscribeWindowSignal } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/windowSignalEvents'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import type { AgentRunEvent } from '../../../src/shared/contracts/dto/agentRunState'

const bridge = vi.hoisted(() => ({ hub: null as ReturnType<typeof createPtyEventHub> | null }))
vi.mock('../../../src/app/renderer/shell/utils/ptyEventHub', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/app/renderer/shell/utils/ptyEventHub')>()),
  getPtyEventHub: () => bridge.hub!,
}))
afterEach(cleanup)

it('flashes and publishes the shockwave for the fixture hook sequence even before nodes rerender', async () => {
  let deliver: (event: TerminalSessionStateEvent) => void = () => {}
  bridge.hub = createPtyEventHub({
    onData: () => () => {},
    onExit: () => () => {},
    onState: listener => {
      deliver = listener
      return () => {}
    },
  })
  const worker = new PtyStreamHub({
    replayWindowMaxBytes: 64000,
    ptyRuntime: {
      spawnSession: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => () => {},
      onExit: () => () => {},
    },
  })
  worker.registerClient({
    clientId: 'renderer',
    kind: 'desktop',
    ws: {
      OPEN: 1,
      readyState: 1,
      send: (raw: string) => {
        const frame = JSON.parse(raw)
        if (frame.type === 'state') {
          deliver(frame)
        }
      },
    } as unknown as WebSocket,
  })
  const events: AgentRunEvent[] = []
  const cursor = worker.agentRuns.registry.list()
  worker.agentRuns.registry.subscribe({ epoch: cursor.epoch, afterSeq: cursor.seq }, {}, event =>
    events.push(event),
  )
  const scope = document.createElement('div')
  scope.innerHTML = '<div class="react-flow__node" data-id="node"></div>'
  document.body.append(scope)
  const signals: { kind: string; nodeId: string }[] = []
  const unsubscribe = subscribeWindowSignal(event => signals.push(event))
  const node = {
    id: 'node',
    position: { x: 0, y: 0 },
    data: { kind: 'agent', status: 'standby', sessionId: 's' } as TerminalNodeData,
  }
  const view = render(
    <WorkspaceWindowSignals nodes={[node]} canvasRef={{ current: scope }} enabled />,
  )
  const server = createServer()
  vi.spyOn(server, 'listen').mockImplementation((...args: unknown[]) => {
    const ready = args.at(-1) as () => void
    ready()
    return server
  })
  vi.spyOn(server, 'address').mockReturnValue({ address: '127.0.0.1', family: 'IPv4', port: 43123 })
  const channel = createClaudeHookChannel({
    createHttpServer: ((listener: (...args: unknown[]) => void) => {
      server.on('request', listener)
      return server
    }) as typeof createServer,
  })
  channel.onState(event => worker.registerSessionAgentState(event))
  const reservation = await channel.reserveSpawn()
  reservation.commit('s')
  const hook = (hookEventName: string, state: 'working' | 'done') =>
    new Promise<void>(resolve => {
      const request = Object.assign(new EventEmitter(), {
        method: 'POST',
        url: '/hooks/claude',
        headers: {
          'content-type': 'application/json',
          'x-opencove-hook-token': reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN,
        },
        setTimeout: () => {},
        destroy: () => {},
      })
      const response = {
        statusCode: 0,
        end: () => {
          expect(response.statusCode).toBe(204)
          resolve()
        },
      }
      server.emit('request', request, response)
      request.emit(
        'data',
        JSON.stringify({ version: 1, hookEventName, state, claudeSessionId: 'provider-session' }),
      )
      request.emit('end')
    })
  try {
    await act(() => hook('Stop', 'done'))
    expect(signals).toEqual([])
    expect(events.filter(event => event.type === 'agent.turn_completed')).toEqual([])
    await act(async () => {
      await hook('UserPromptSubmit', 'working')
      await hook('Stop', 'done')
    })
    expect(events.filter(event => event.type === 'agent.turn_completed')).toHaveLength(1)
    expect(worker.agentRuns.registry.get({ sessionId: 's' })?.turnOutcome).toBe('completed')
    expect(scope.querySelector('[data-id="node"]')).toHaveAttribute('data-cove-signal', 'complete')
    expect(signals).toEqual([{ kind: 'complete', nodeId: 'node' }])
    await act(() => hook('Stop', 'done'))
    expect(signals).toHaveLength(1)
  } finally {
    view.unmount()
    unsubscribe()
    bridge.hub.dispose()
    worker.agentRuns.dispose()
    scope.remove()
    await channel.dispose()
  }
})
