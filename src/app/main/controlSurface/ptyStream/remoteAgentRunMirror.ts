import type {
  AgentRunSnapshot,
  RemoteAgentRunUpdate,
} from '../../../../shared/contracts/dto/agentRunState'
import type { TerminalSessionStateEvent } from '../../../../shared/contracts/dto'
import { agentRuntimeFrameSchema } from '../../../../shared/contracts/dto/agentRunStateSchema'

/** Remote decisions only. Socket-attempt fencing is supplied by the owning PTY proxy. */
export class RemoteAgentRunMirror {
  private cursor: { epoch: string; afterSeq: number } | null = null
  private readonly snapshots = new Map<string, AgentRunSnapshot>()
  private supported = false
  private ready = false
  private awaitingBaseline = true
  constructor(
    private readonly ports: {
      sessions: () => Iterable<string>
      emit: (sessionId: string, event: TerminalSessionStateEvent) => void
      reconnect: () => void
    },
  ) {}
  hello() {
    return { agentRunEvents: 1, ...(this.cursor ? { agentRunCursor: { ...this.cursor } } : {}) }
  }
  private emit(sessionId: string, remoteAgentRun: RemoteAgentRunUpdate) {
    this.ports.emit(sessionId, { sessionId, remote: true, state: 'working', remoteAgentRun })
  }
  attach(sessionId: string): void {
    const snapshot = this.snapshots.get(sessionId)
    this.emit(
      sessionId,
      this.ready && snapshot ? { type: 'snapshot', snapshot } : { type: 'unavailable' },
    )
  }
  forget(sessionId: string): void {
    if (this.snapshots.get(sessionId)?.state === 'exited') {
      this.snapshots.delete(sessionId)
    }
  }
  disconnect(): void {
    this.supported = false
    this.ready = false
    for (const sessionId of this.ports.sessions()) {
      this.emit(sessionId, { type: 'unavailable' })
    }
  }
  private resync(): void {
    this.disconnect()
    this.cursor = null
    this.snapshots.clear()
    this.awaitingBaseline = true
  }
  handleMessage(raw: string): boolean {
    let input: { type?: unknown; capabilities?: { agentRunEvents?: unknown } }
    try {
      input = JSON.parse(raw)
    } catch {
      return false
    }
    if (!input || typeof input !== 'object') {
      return false
    }
    if (input.type === 'hello_ack') {
      this.supported = input.capabilities?.agentRunEvents === 1
      this.ready = false
      this.awaitingBaseline = this.cursor === null
      if (!this.supported) {
        this.resync()
      }
      return false
    }
    if (typeof input.type !== 'string' || !input.type.startsWith('agent.')) {
      return false
    }
    if (!this.supported) {
      return true
    }
    const parsed = agentRuntimeFrameSchema.safeParse(input)
    if (!parsed.success) {
      this.resync()
      this.ports.reconnect()
      return true
    }
    const frame = parsed.data
    if (frame.type === 'agent.resync_required') {
      this.resync()
      this.supported = true
      return true
    }
    if (frame.type === 'agent.baseline') {
      if (!this.awaitingBaseline) {
        this.resync()
        this.ports.reconnect()
        return true
      }
      this.cursor = { epoch: frame.epoch, afterSeq: frame.seq }
      this.snapshots.clear()
      for (const snapshot of frame.agents) {
        this.snapshots.set(snapshot.sessionId, snapshot)
      }
      this.awaitingBaseline = false
      return true
    }
    if (frame.type === 'agent.ready') {
      if (!this.cursor || frame.epoch !== this.cursor.epoch || frame.seq !== this.cursor.afterSeq) {
        this.resync()
        this.ports.reconnect()
        return true
      }
      this.ready = true
      for (const sessionId of this.ports.sessions()) {
        this.attach(sessionId)
      }
      return true
    }
    const event = frame.event
    if (!this.cursor || event.epoch !== this.cursor.epoch || event.seq > this.cursor.afterSeq + 1) {
      this.resync()
      this.ports.reconnect()
      return true
    }
    if (event.seq <= this.cursor.afterSeq) {
      return true
    }
    this.cursor.afterSeq = event.seq
    const id = event.snapshot.sessionId
    this.snapshots.set(id, event.snapshot)
    const attached = new Set(this.ports.sessions()).has(id)
    if (attached) {
      this.emit(id, { type: 'event', event })
    } else if (event.snapshot.state === 'exited') {
      this.snapshots.delete(id)
    }
    return true
  }
}
