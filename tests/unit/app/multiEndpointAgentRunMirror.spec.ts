import { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'
import { expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { createMultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import { RemotePtyEndpointProxy } from '../../../src/app/main/controlSurface/ptyStream/remotePtyEndpointProxy'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { subscribeAgentRuntimeSocket } from '../../../src/app/main/controlSurface/ptyStream/agentRuntimeSocket'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'

it('routes negotiated Worker decisions through the production proxy to Home and fences replaced sockets', () => {
  const remote = new AgentRunStateRegistry({
    epoch: 'remote-epoch',
    now: () => 1,
    createTurnId: () => 'remote-turn',
    schedule: () => () => {},
  })
  const source = new AgentRunStateRuntime(remote, () => 1)
  source.observe({
    sessionId: 'remote-id',
    agentProvider: 'codex',
    state: 'working',
    source: 'codex_hook',
    hookEventName: 'UserPromptSubmit',
  })
  const attach = vi
    .spyOn(RemotePtyEndpointProxy.prototype, 'attach')
    .mockImplementation(function (id) {
      this.prepareAttach(id)
    })
  const home = createMultiEndpointPtyRuntime({
    localRuntime: {
      spawnSession: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => () => {},
      onExit: () => () => {},
    },
    topology: {} as WorkerTopologyStore,
    disposeLocalRuntime: false,
  })
  const hub = new PtyStreamHub({ ptyRuntime: home, replayWindowMaxBytes: 64000 })
  const stop = home.onState!(event => hub.registerSessionAgentState(event))
  const id = home.registerRemoteSession({ endpointId: 'remote', remoteSessionId: 'remote-id' })
  const proxy = attach.mock.instances[0] as unknown as {
    socket: object | null
    handleSocketMessage: (socket: object, raw: string) => void
    closeSocket: () => void
  }
  const socket = { terminate: vi.fn() }
  proxy.socket = socket
  const frames: string[] = []
  const ws = Object.assign(new EventEmitter(), {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send: (raw: string) => {
      frames.push(raw)
      proxy.handleSocketMessage(socket, raw)
    },
    terminate: vi.fn(),
  })
  try {
    proxy.handleSocketMessage(
      socket,
      JSON.stringify({ type: 'hello_ack', capabilities: { agentRunEvents: 1 } }),
    )
    subscribeAgentRuntimeSocket(remote, ws as unknown as WebSocket, undefined)
    hub.agentRuns.setBindings([
      { sessionId: id, nodeId: 'home-node', projectId: 'home-project', remote: true },
    ])
    expect(hub.agentRuns.registry.get({ nodeId: 'home-node' })).toMatchObject({
      sessionId: id,
      state: 'working',
      turn: { id: 'remote-turn' },
      quality: 'authoritative',
    })
    source.observe({
      sessionId: 'remote-id',
      state: 'standby',
      source: 'codex_hook',
      hookEventName: 'Stop',
    })
    expect(hub.observeAgentState(id)).toMatchObject({ state: 'idle', turnOutcome: 'completed' })
    const before = hub.agentRuns.registry.list()
    const event = frames.find(frame => JSON.parse(frame).type === 'agent.event')!
    proxy.handleSocketMessage({}, event) // The retired socket must not reach either message decoder.
    expect(hub.agentRuns.registry.list()).toEqual(before)
    proxy.closeSocket()
    expect(hub.observeAgentState(id)).toMatchObject({ state: 'unknown', quality: 'degraded' })
  } finally {
    ws.emit('close')
    stop()
    home.dispose()
    hub.agentRuns.dispose()
    source.dispose()
    attach.mockRestore()
  }
})
