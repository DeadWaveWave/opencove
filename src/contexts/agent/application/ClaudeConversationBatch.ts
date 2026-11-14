import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
type Request = NonNullable<ClaudeTranscriptObservation['conversation']>
/** A later authenticated Start supersedes earlier, unattached predecessor evidence.
 * A matching Start in the batch preserves that conversation's ordered turn history. */
export function supersededConversationIds(batch: Request[], current?: string): Set<string> {
  const starts = batch.filter(r => r.event.hookEventName === 'SessionStart')
  const known = new Set([current, ...starts.map(r => r.event.claudeSessionId)])
  const latest = Math.max(...starts.map(r => r.event.emittedAtMs ?? -Infinity))
  return new Set(
    batch
      .filter(
        r => !known.has(r.event.claudeSessionId) && (r.event.emittedAtMs ?? Infinity) < latest,
      )
      .map(r => r.event.claudeSessionId),
  )
}

export function supersededUnattachedEnd(
  request: Request,
  batch: Request[],
  current?: string,
): boolean {
  const event = request.event
  if (event.hookEventName !== 'SessionEnd' || event.claudeSessionId === current) {
    return false
  }
  const starts = batch.filter(
    r =>
      r.event.hookEventName === 'SessionStart' && r.event.claudeSessionId === event.claudeSessionId,
  )
  return (
    starts.some(r => r.event.emittedAtMs! > event.emittedAtMs!) &&
    !starts.some(r => r.event.emittedAtMs! <= event.emittedAtMs!)
  )
}

export function retiredEvent(
  event: Request['event'],
  current: string | undefined,
  retired: ReadonlySet<string>,
  pending: Request[],
): boolean {
  return (
    retiredConversationIdentity(event.claudeSessionId, current, retired, pending) &&
    event.hookEventName !== 'SessionStart'
  )
}
export function retiredConversationIdentity(
  id: string,
  current: string | undefined,
  retired: ReadonlySet<string>,
  pending: Request[],
): boolean {
  return (
    (retired.has(id) && id !== current) ||
    (id === current &&
      pending.some(
        r => r.event.hookEventName === 'SessionStart' && r.event.claudeSessionId !== current,
      ))
  )
}

/** Fold one validated relay-order batch without publishing tied live evidence. */
export function foldConversationBatch(
  batch: Request[],
  ports: {
    retired(event: Request['event']): boolean
    commit(request: Request): void
    ambiguous(): void
    reject(request: Request): void
  },
): boolean {
  for (let i = 0; i < batch.length; ) {
    let end = i + 1
    while (end < batch.length && batch[end].event.emittedAtMs === batch[i].event.emittedAtMs) {
      end++
    }
    const group = batch.slice(i, end)
    if (group.filter(item => !ports.retired(item.event)).length > 1) {
      ports.ambiguous()
      for (const request of batch.slice(i)) {
        ports.reject(request)
      }
      return false
    }
    for (const request of group) {
      ports.commit(request)
    }
    i = end
  }
  return true
}

export function orderConversationBatch(
  batch: Request[],
  current: string | undefined,
  generation: number,
): Request[] {
  return batch
    .filter(request => {
      if (!supersededUnattachedEnd(request, batch, current)) {
        return true
      }
      request.publish(generation, 'ignore')
      return false
    })
    .sort((a, b) => a.event.emittedAtMs! - b.event.emittedAtMs!)
}
export function rejectConversationBatch(batch: Request[], generation: number): void {
  for (const request of batch) {
    request.publish(generation, 'ignore')
  }
}

export function preservesOrdinaryConversationEnd(
  action: string,
  event: Request['event'],
  pending: boolean,
  completed: string | null,
  previous: string | null,
): boolean {
  return (
    action === 'end' &&
    event.sessionEndReason !== 'clear' &&
    (!pending || (completed !== null && completed !== previous))
  )
}

export function conversationOrder(
  event: Request['event'],
  committedAt: number,
  hasPending: boolean,
): 'ordered' | 'untimed' | 'late' | 'invalid' {
  const at = event.emittedAtMs
  if (at === undefined) {
    return committedAt === -Infinity && !hasPending ? 'untimed' : 'invalid'
  }
  if (!Number.isFinite(at)) {
    return 'invalid'
  }
  if (at > committedAt) {
    return 'ordered'
  }
  return (event.hookEventName === 'SessionStart' && event.sessionStartSource === 'clear') ||
    (event.hookEventName === 'SessionEnd' && event.sessionEndReason === 'clear')
    ? 'invalid'
    : 'late'
}
export function predecessorConversationEnd(
  event: Request['event'],
  startedAt: number | undefined,
): boolean {
  return (
    event.hookEventName === 'SessionEnd' &&
    event.sessionEndReason === 'clear' &&
    event.emittedAtMs !== undefined &&
    event.emittedAtMs < (startedAt ?? -Infinity)
  )
}

/** Once a Start identifies the epoch, earlier activity with that wire ID is predecessor proof. */
export function discardPrestartRequests(
  pending: Request[],
  id: string,
  at: number | undefined,
  generation: number,
  retired: ReadonlySet<string>,
): Request[] {
  return pending.filter(r => {
    if (
      !(retired.has(r.event.claudeSessionId) && r.event.claudeSessionId !== id) &&
      (r.event.claudeSessionId !== id || r.event.emittedAtMs! >= (at ?? -Infinity))
    ) {
      return true
    }
    r.publish(generation, 'ignore')
    return false
  })
}

/** Old boundaries remain replayable history without invalidating newer captures. */
export function predatesPendingStart(event: Request['event'], pending: Request[]): boolean {
  return (
    event.emittedAtMs !== undefined &&
    pending.some(
      r => r.event.hookEventName === 'SessionStart' && r.event.emittedAtMs! > event.emittedAtMs!,
    )
  )
}
