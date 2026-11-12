import type {
  AgentDelivery,
  AgentDeliveryLookup,
} from '../../../shared/contracts/dto/agentDelivery'
import type { RunStateFence } from './ports/PromptDeliveryPorts'

export interface DeliveryRecord {
  dto: AgentDelivery
  initial: RunStateFence
  codexSteer: boolean
  submitAt: number
  cleanups: (() => void)[]
  resolvedAt?: number
  reconcilable: boolean
}
const resolved = (r: DeliveryRecord) => ['submitted', 'not_sent'].includes(r.dto.status)
/** Sole volatile record owner. Unresolved attempts never evict to admit new writes. */
export class PromptDeliveryRecords {
  readonly records = new Map<string, DeliveryRecord>()
  private readonly codexSequences = new Map<string, number>()
  constructor(private readonly now: () => number) {}
  prune(): void {
    for (const r of this.records.values()) {
      if (resolved(r) && this.now() - (r.resolvedAt ?? Infinity) >= 30 * 60_000) {
        this.remove(r)
      }
    }
  }
  private remove(r: DeliveryRecord) {
    this.records.delete(r.dto.deliveryId)
    this.stopReconciliation(r)
    if (
      ![...this.records.values()].some(
        other => other.dto.epoch === r.dto.epoch && other.dto.incarnation === r.dto.incarnation,
      )
    ) {
      this.codexSequences.delete(`${r.dto.epoch}:${r.dto.incarnation}`)
    }
  }
  get(id: string): AgentDeliveryLookup {
    this.prune()
    const r = this.records.get(id)
    return r ? structuredClone(r.dto) : { available: false, deliveryId: id, reason: 'unavailable' }
  }
  forTurn(sessionId: string, turnId: string): string[] {
    this.prune()
    return [...this.records.values()]
      .filter(r => r.dto.sessionId === sessionId && r.dto.turnId === turnId)
      .map(r => r.dto.deliveryId)
  }
  allocate(id: string, fence: RunStateFence, mode: 'turn' | 'steer'): DeliveryRecord | undefined {
    this.prune()
    const session = [...this.records.values()].filter(
      r => r.dto.sessionId === fence.snapshot.sessionId,
    )
    if (session.length >= 32) {
      const oldest = session.find(resolved)
      if (!oldest) {
        return
      }
      this.remove(oldest)
    }
    if (this.records.size >= 1024) {
      const oldest = [...this.records.values()].find(resolved)
      if (!oldest) {
        return
      }
      this.remove(oldest)
    }
    const r: DeliveryRecord = {
      dto: {
        available: true,
        deliveryId: id,
        epoch: fence.epoch,
        incarnation: fence.incarnation,
        sessionId: fence.snapshot.sessionId,
        nodeId: fence.snapshot.nodeId,
        mode,
        turnId: mode === 'steer' ? fence.snapshot.turn?.id : undefined,
        status: 'pending',
        evidenceWindow: 'open',
        createdAt: this.now(),
      },
      initial: fence,
      codexSteer: mode === 'steer' && fence.snapshot.provider === 'codex',
      submitAt: Infinity,
      cleanups: [],
      reconcilable: true,
    }
    this.records.set(id, r)
    return r
  }
  blocking(fence: RunStateFence, excluding?: DeliveryRecord): DeliveryRecord | undefined {
    return [...this.records.values()].find(
      r =>
        r !== excluding &&
        r.dto.epoch === fence.epoch &&
        r.dto.incarnation === fence.incarnation &&
        !resolved(r) &&
        !(r.codexSteer && r.dto.status === 'dispatched'),
    )
  }
  keepCleanup(r: DeliveryRecord, stop: () => void): void {
    if (r.reconcilable) {
      r.cleanups.push(stop)
    } else {
      stop()
    }
  }
  stopReconciliation(r: DeliveryRecord): void {
    r.reconcilable = false
    r.dto.evidenceWindow = 'closed'
    r.cleanups.splice(0).forEach(stop => stop())
  }
  settle(r: DeliveryRecord, status: 'submitted' | 'not_sent'): void {
    r.dto.status = status
    r.resolvedAt ??= this.now()
    this.stopReconciliation(r)
  }
  claimCodex(r: DeliveryRecord, sequence: number): boolean {
    const key = `${r.dto.epoch}:${r.dto.incarnation}`
    if (sequence <= (this.codexSequences.get(key) ?? -1)) {
      return false
    }
    const first = [...this.records.values()].find(
      other =>
        other.codexSteer &&
        other.dto.incarnation === r.dto.incarnation &&
        other.dto.epoch === r.dto.epoch &&
        other.dto.status === 'dispatched',
    )
    if (first !== r) {
      return false
    }
    this.codexSequences.set(key, sequence)
    return true
  }
  dispose(): void {
    for (const r of this.records.values()) {
      this.remove(r)
    }
    this.codexSequences.clear()
  }
}
