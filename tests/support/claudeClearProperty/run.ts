import { clearPropertyRuntime } from './runtime'
import { ClearReference } from './reference'
import type { ClearCase } from './cases'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

/** Independent evidence model: no lifecycle classifier, registry ready flag, or production
 * admission decision is used to decide whether the received evidence permits input. */
export async function runClearCase(scenario: ClearCase, check = true) {
  const f = clearPropertyRuntime(),
    model = new ClearReference()
  let step = -1,
    conservativeRefusals = 0,
    conservativeDeliveries = 0
  const errors: { step: number; reason: string }[] = []
  const assert = (publication = false, liveness = false) => {
    const verdict = model.verdict()
    const fence = f.fence()
    const admitted = !promptAdmission(
      fence,
      () => ({ supported: true, submitDelayMs: 300 }),
      'refuse',
    )
    if (admitted && !verdict.receipt) {
      errors.push({
        step,
        reason: `${publication ? 'publication ' : ''}unsafe admission: ${JSON.stringify(verdict)}`,
      })
    }
    if (
      (fence.claudeClearReady && !verdict.clearAllowed) ||
      (model.clearSeen &&
        admitted &&
        f.registry.promptIdentity(fence)?.providerSessionId !== verdict.id)
    ) {
      errors.push({ step, reason: 'receipt belongs to another conversation' })
    }
    if (!publication && !liveness && !admitted && verdict.receipt) {
      conservativeRefusals++
    }
    if (liveness && verdict.due && !admitted) {
      errors.push({ step, reason: `quiet lockout: ${JSON.stringify(verdict)}` })
    }
    return verdict
  }
  if (check) {
    f.registry.subscribe({ epoch: 'e', afterSeq: f.registry.list().seq }, {}, () => {
      assert(true)
    })
  }
  try {
    for (const event of scenario.events) {
      step++
      const io = ['file', 'metadata', 'user', 'capture'].includes(event.kind)
      const capture = io
        ? { generation: f.capture(event.epoch, event.id), epoch: event.epoch }
        : undefined
      if (capture && event.kind !== 'capture' && !model.hasCapture(capture.epoch)) {
        model.consume({ ...event, kind: 'capture' }, capture)
      }
      model.consume(event, capture)
      f.dispatch(event)
      const verdict = check ? assert(false, event.kind === 'tick') : model.verdict()
      if (check) {
        // oxlint-disable-next-line no-await-in-loop -- actual service checked after every input
        const writes = await f.probe()
        if (writes && !verdict.receipt) {
          errors.push({ step, reason: 'paste/Enter without model receipt' })
        }
        if (!writes && verdict.receipt && event.kind !== 'tick') {
          conservativeDeliveries++
        }
        if (!writes && event.kind === 'tick' && verdict.due) {
          errors.push({ step, reason: 'delivery quiet lockout' })
        }
      }
    }
    model.advance(6001)
    f.advance(6001)
    const verdict = check ? assert(false, true) : model.verdict()
    if (check) {
      const writes = await f.probe()
      if (writes && !verdict.receipt) {
        errors.push({ step, reason: 'expiry authorized paste/Enter' })
      }
      if (!writes && verdict.due) {
        errors.push({ step, reason: 'expiry lockout' })
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
    return {
      errors,
      output,
      conservativeRefusals,
      conservativeDeliveries,
      captures: [...f.captures],
      steps: scenario.events.length + 1,
    }
  } finally {
    f.dispose()
  }
}
