// @vitest-environment node
import { expect, it } from 'vitest'
import { clearInterleavingFixture, phases, type Phase } from './claudeClearInterleaving.helpers'
import { permutations } from '../contexts/claudeConversationOrdering.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { probeClearDelivery } from '../../support/clearDeliveryProbe'

async function replay(phase: Phase, order: number[]) {
  const f = await clearInterleavingFixture(phase)
  const errors: string[] = []
  const assertPublished = (step: string) => {
    const fence = f.fence()
    if (fence.snapshot.turn) {
      errors.push(`${step}: unexpected turn`)
    }
    const completedReceipt =
      phase === 'completed turn' &&
      fence.snapshot.state === 'idle' &&
      fence.snapshot.source === 'claude_hook' &&
      fence.lastTurnEnd?.hookEventName === 'Stop'
    if (!fence.claudeClearReady && !completedReceipt) {
      for (const mode of ['refuse', 'steer'] as const) {
        if (!promptAdmission(fence, () => ({ supported: true, submitDelayMs: 300 }), mode)) {
          errors.push(`${step}: admitted ${mode}`)
        }
      }
    }
  }
  const assertSafe = async (step: string) => {
    assertPublished(step)
    const fence = f.fence()
    if (
      !fence.claudeClearReady &&
      !(
        phase === 'completed turn' &&
        fence.snapshot.state === 'idle' &&
        fence.snapshot.source === 'claude_hook' &&
        fence.lastTurnEnd?.hookEventName === 'Stop'
      )
    ) {
      if ((await probeClearDelivery(f)).writes) {
        errors.push(`${step}: delivery write`)
      }
    }
  }
  f.registry.subscribe({ epoch: 'worker', afterSeq: f.registry.list().seq }, {}, () =>
    assertPublished('publication'),
  )
  try {
    expect(f.captured.A).toBeUndefined()
    if (f.captured.B !== f.fence().conversationGeneration) {
      errors.push('capture: missing generation')
    }
    // Every retired transition must be the identity at EVERY reachable live prefix. Hence any
    // shuffle of these eight transitions among five live ones equals a tested live permutation.
    // This proves all 13! orders by factorization, rather than sampling 13! interleavings.
    for (const index of [...order, -1]) {
      for (const event of f.stale) {
        const before = f.view()
        // oxlint-disable-next-line no-await-in-loop -- check every transition before advancing
        await event.run()
        if (f.view() !== before) {
          errors.push(`${event.name}: mutated live state`)
        }
        // oxlint-disable-next-line no-await-in-loop -- actual dispatch at every intermediate step
        await assertSafe(event.name)
      }
      if (index !== -1) {
        // oxlint-disable-next-line no-await-in-loop -- exhaustive arrival order
        await f.live[index].run()
        // oxlint-disable-next-line no-await-in-loop -- actual dispatch at every intermediate step
        await assertSafe(f.live[index].name)
      }
    }
    await f.settle()
    await assertSafe('settled')
    return { view: f.output(), errors }
  } finally {
    await f.close()
  }
}
for (const phase of phases) {
  it(`fences every clear-side interleaving: ${phase} (120 representatives, 13! orders)`, async () => {
    const canonical = await replay(phase, [0, 1, 2, 3, 4])
    let failed = 0
    let first: unknown
    for (const order of permutations([0, 1, 2, 3, 4])) {
      // oxlint-disable-next-line no-await-in-loop -- fake timer and runtime ownership per permutation
      const actual = await replay(phase, order)
      if (actual.errors.length || actual.view !== canonical.view) {
        failed++
        first ??= {
          order,
          errors: actual.errors.slice(0, 12),
          divergent: actual.view !== canonical.view,
        }
      }
    }
    expect({ failed, first }, phase).toEqual({ failed: 0, first: undefined })
  }, 60_000)
}
