import type { WebSocket } from 'ws'
import type { AgentRunStateRegistry } from '../../../../contexts/agent/application/AgentRunStateRegistry'

/** Opt-in Worker stream; runtime cursor never enters PTY replay handling. */
export function subscribeAgentRuntimeSocket(
  registry: AgentRunStateRegistry,
  ws: WebSocket,
  cursor: unknown,
): void {
  let unsubscribe = () => {}
  const close = () => unsubscribe()
  ws.once('close', close)
  const send = (frame: unknown) => {
    if (ws.readyState !== ws.OPEN) {
      return
    }
    if (ws.bufferedAmount > 1024 * 1024) {
      ws.terminate()
      return
    }
    try {
      ws.send(JSON.stringify(frame))
    } catch {
      close()
      ws.terminate()
    }
  }
  const subscribe = (input: { epoch: string; afterSeq: number }) => {
    let resync = false
    unsubscribe = registry.subscribe(input, {}, event => {
      if (event.type === 'resync_required') {
        resync = true
        send({ ...event, type: 'agent.resync_required' })
      } else {
        send({ type: 'agent.event', event })
      }
    })
    return resync
  }
  const value = cursor as { epoch?: unknown; afterSeq?: unknown } | null
  const canResume = value && typeof value.epoch === 'string' && typeof value.afterSeq === 'number'
  if (
    !canResume ||
    subscribe({ epoch: value.epoch as string, afterSeq: value.afterSeq as number })
  ) {
    const baseline = registry.list()
    send({ type: 'agent.baseline', ...baseline })
    subscribe({ epoch: baseline.epoch, afterSeq: baseline.seq })
  }
  const { epoch, seq } = registry.list()
  send({ type: 'agent.ready', epoch, seq })
  if (ws.readyState !== ws.OPEN) {
    close()
  }
}
