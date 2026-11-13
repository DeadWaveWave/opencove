import { clearPropertyRuntime } from './runtime'
import type { ClearCase, ClearEvent } from './cases'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

/** Independent evidence model: no lifecycle classifier, registry ready flag, or production
 * admission decision is used to decide whether the received evidence permits input. */
export async function runClearCase(scenario: ClearCase, check = true) {
  const f = clearPropertyRuntime(),
    seen = new Map<string, ClearEvent>()
  const starts = new Map<string, Set<number>>([
      ['A', new Set([10])],
      ['B', new Set([110])],
    ]),
    input = new Map<number, number>()
  let latest = 1,
    step = -1,
    latestStart = 1,
    previousTurn: string | undefined,
    fileSequence = -Infinity
  const errors: { step: number; reason: string }[] = []
  const assert = (publication = false) => {
    const fence = f.fence(),
      id = scenario.ids[latest]
    const activities = [...seen.values()]
      .filter(
        e =>
          e.epoch === latest &&
          e.kind === 'hook' &&
          !['SessionStart', 'Notification'].includes(e.name!),
      )
      .sort((a, b) => a.at - b.at)
    const last = activities.at(-1),
      startAt = latest * 100 + 10
    const clearProof =
      starts.has(id) &&
      starts.get(id)!.size === 1 &&
      Math.max(...starts.get(id)!) === startAt &&
      !activities.length &&
      !input.has(latest)
    const stopProof =
      starts.has(id) && last?.name === 'Stop' && (input.get(latest) ?? -Infinity) < last.at
    const proof = (clearProof || stopProof) && f.namespace() === id
    if (
      !proof &&
      !promptAdmission(fence, () => ({ supported: true, submitDelayMs: 300 }), 'refuse')
    ) {
      errors.push({
        step,
        reason: `${publication ? 'publication ' : ''}admission without latest receipt: epoch ${latest}, ${last?.name ?? 'empty'}`,
      })
    }
    if (
      fence.claudeClearReady &&
      (!clearProof || f.registry.promptIdentity(fence)?.providerSessionId !== id)
    ) {
      errors.push({ step, reason: 'clear readiness before latest activity was folded' })
    }
    if (
      !f.replaying() &&
      fence.snapshot.turn &&
      fence.snapshot.turn.id !== previousTurn &&
      (f.turnIdentity() ?? f.namespace()) !== id &&
      startAt <= Math.max(...[...seen.values()].map(e => e.at), 110)
    ) {
      errors.push({ step, reason: 'live turn created for retired conversation' })
    }
    previousTurn = fence.snapshot.turn?.id
    return proof
  }
  if (check) {
    f.registry.subscribe({ epoch: 'e', afterSeq: f.registry.list().seq }, {}, () => {
      assert(true)
    })
  }
  try {
    for (const event of scenario.events) {
      step++
      const knownBefore = starts.has(event.id)
      if (event.kind === 'hook') {
        if (event.epoch >= latest && event.name !== 'Notification') {
          latest = Math.max(latest, event.epoch)
        }
        if (event.name === 'SessionStart') {
          latestStart = Math.max(latestStart, event.epoch)
          const times = starts.get(event.id) ?? new Set<number>()
          times.add(event.at)
          starts.set(event.id, times)
        }
        seen.set(`${event.kind}:${event.epoch}:${event.at}`, event)
      }
      // Qualify IO independently of the reducer's accept/reject result. The real capture port
      // supplies its immutable generation; the model checks namespace, generation and ordinal.
      if (event.kind === 'file' || event.kind === 'metadata' || event.kind === 'user') {
        const before = f.fence(),
          captured = f.capture(event.epoch, event.id)
        const matched =
          !f.replaying() &&
          captured === before.conversationGeneration &&
          event.id === scenario.ids[latest] &&
          f.namespace() === event.id
        const boundary = Math.max(
          before.snapshot.turn?.startedAt ?? -Infinity,
          before.snapshot.lastEndedTurn?.endedAt ?? -Infinity,
          before.lastTurnEnd?.observedAt ?? -Infinity,
        )
        if (
          matched &&
          (event.kind !== 'file' || (event.at > fileSequence && 100000 + event.at >= boundary))
        ) {
          if (event.kind === 'file') {
            fileSequence = event.at
          }
          if (event.kind === 'user' || (event.kind === 'file' && event.name !== 'idle')) {
            input.set(latest, Math.max(input.get(latest) ?? -Infinity, event.at))
          }
        }
      }
      const retired =
        event.kind !== 'tick' &&
        !f.replaying() &&
        event.epoch < latestStart &&
        event.id !== scenario.ids[latestStart] &&
        knownBefore
      const beforeRetired = retired
        ? JSON.stringify({ fence: f.fence(), output: f.output() })
        : undefined
      f.dispatch(event)
      if (
        check &&
        retired &&
        beforeRetired !== JSON.stringify({ fence: f.fence(), output: f.output() })
      ) {
        errors.push({ step, reason: 'retired callback changed live state or receipt' })
      }
      if (check && !assert()) {
        // oxlint-disable-next-line no-await-in-loop -- every unsafe step dispatches a real service
        if (await f.probe()) {
          errors.push({ step, reason: 'paste/Enter without latest receipt' })
        }
      }
    }
    // Expiry cannot turn missing Start/Stop or unresolved activity into an input certificate.
    f.advance(6001)
    if (check && !assert()) {
      if (await f.probe()) {
        errors.push({ step, reason: 'expiry authorized paste/Enter' })
      }
    }
    const output = JSON.parse(
      JSON.stringify(f.output(), (key, value) =>
        [
          'startedAt',
          'endedAt',
          'archivedAt',
          'observedAt',
          'lastActivityAt',
          'lastTransitionAt',
        ].includes(key)
          ? undefined
          : value,
      ),
    )
    return { errors, output, steps: scenario.events.length + 1 }
  } finally {
    f.dispose()
  }
}
