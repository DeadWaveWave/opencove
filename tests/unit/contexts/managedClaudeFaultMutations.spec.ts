// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { faultHarness } from './managedClaudeFaultHarness'
import type { FaultCase } from './managedClaudeFaultModel'
import { ManagedClaudeLaunchOwner as Owner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import { ManagedClaudeRuntimeCleanup as Cleanup } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeRuntimeCleanup'
import type { ManagedClaudeLaunchPorts } from '../../../src/contexts/agent/application/managedClaudeLaunch/ports'
import { createAppError } from '../../../src/shared/errors/appError'
import { executeLegacyFault } from './managedClaudeLegacyFaultHarness'

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const baseline: FaultCase = {
  initial: 'adoption',
  fault: 'none',
  event: 'none',
  edge: 'identity:before',
}
type Harness = Awaited<ReturnType<typeof faultHarness>>
async function detected(
  config: FaultCase,
  mutate: (f: Harness) => void,
  failures: string[],
  recovery = false,
) {
  const f = await faultHarness(config)
  try {
    mutate(f)
    if (recovery) {
      f.model.alive.clear()
      f.model.changedByOther = true
      f.prepare('agent', 'primary')
    } else {
      f.start()
    }
    await f.settle()
    const violations = f.models.flatMap(model => model.violations).join('\n')
    for (const failure of failures) {
      expect(violations).toContain(failure)
    }
    expect(() => f.models.forEach(model => model.assertValid())).toThrow()
  } finally {
    f.dispose()
  }
}

it('detects premature handoff independently of admission implementation', async () => {
  await detected(
    { ...baseline, initial: 'owned', fault: 'validation' },
    () => {
      const begin = Owner.prototype.beginLaunch
      vi.spyOn(Owner.prototype, 'beginLaunch').mockImplementation(function (attempt) {
        begin.call(this, attempt)
        void this.complete(attempt, {
          runtimeSessionId: null,
          tuple: { resumeSessionId: 'original', resumeSessionIdVerified: true },
        }).catch(() => {})
      })
    },
    [
      'effect without independent admission permission',
      'pre-admission ledger detached',
      'pre-admission node detached',
    ],
  )
})

it('detects a created runtime omitted from cleanup custody', async () => {
  await detected(
    { ...baseline, fault: 'registration' },
    () => {
      vi.spyOn(Owner.prototype, 'trackCreatedRuntime').mockImplementation(() => {})
    },
    ['missing cleanup'],
  )
})

it('detects cleanup that skips the reference guard', async () => {
  await detected(
    { ...baseline, fault: 'registration' },
    () => {
      const cleanup = Cleanup.prototype.cleanupRetained
      vi.spyOn(Cleanup.prototype, 'cleanupRetained').mockImplementation(function (id, retry) {
        const ports = (this as unknown as { ports: ManagedClaudeLaunchPorts }).ports
        ports.isRuntimeReferenced = () => false
        return cleanup.call(this, id, retry)
      })
    },
    ['referenced kill', 'dead/foreign reference'],
  )
})

it('detects a cleanup queue whose product retry is disabled', async () => {
  await detected(
    { ...baseline, initial: 'owned', fault: 'admissionKill' },
    () => {
      vi.spyOn(
        Cleanup.prototype as unknown as { retry(id: string): void },
        'retry',
      ).mockImplementation(() => {})
    },
    ['cleanup did not converge'],
  )
})

it('detects duplicate successful kills even across later claims', async () => {
  await detected(
    {
      ...baseline,
      initial: 'fallback',
      fault: 'spawn',
      event: 'delete',
      edge: 'referenceRead:before',
    },
    () => {
      const cleanup = Cleanup.prototype.cleanupRetained
      vi.spyOn(Cleanup.prototype, 'cleanupRetained').mockImplementation(function (id, retry) {
        ;(this as unknown as { terminated: Set<string> }).terminated.clear()
        return cleanup.call(this, id, retry)
      })
    },
    ['duplicate successful kill'],
  )
})

it('rejects the no-fault adoption mutation that prematurely cleans its candidate', async () => {
  await detected(baseline, () => {
    const track = Owner.prototype.trackCreatedRuntime
    vi.spyOn(Owner.prototype, 'trackCreatedRuntime').mockImplementation(function (attempt, id) {
      track.call(this, attempt, id)
      void this.finishLaunch(attempt)
    })
  }, ['outcome: expected success'])
})

it('detects activation using another node runtime', async () => {
  await detected(baseline, () => {
    const complete = Owner.prototype.complete
    vi.spyOn(Owner.prototype, 'complete').mockImplementation(function (attempt, candidate) {
      return complete.call(this, attempt, { ...candidate, runtimeSessionId: 'peer-original' })
    })
  }, [
    'activation of dead/foreign runtime',
    'dead/foreign reference',
    'outcome: wrong runtime association',
  ])
})

it('detects a foreign runtime in a successful command result', async () => {
  await detected(
    baseline,
    f => {
      const run = f.runtime().run
      f.runtime().run = async (...args) => ({
        ...((await run(...args)) as object),
        sessionId: 'peer-original',
      })
    },
    [
      'outcome: wrong runtime association',
      'outcome: returned runtime is not alive',
      'outcome: foreign command runtime',
    ],
  )
})

it('detects wrong effective, receipt and durable tuples', async () => {
  await detected(baseline, () => {
    const complete = Owner.prototype.complete
    vi.spyOn(Owner.prototype, 'complete').mockImplementation(function (attempt, candidate) {
      return complete.call(this, attempt, {
        ...candidate,
        tuple: { resumeSessionId: 'foreign', resumeSessionIdVerified: true },
      })
    })
  }, [
    'outcome: wrong effective tuple',
    'outcome: wrong receipt tuple',
    'outcome: wrong durable tuple',
  ])
})

it('detects a receipt that points at a different runtime', async () => {
  await detected(baseline, () => {
    const complete = Owner.prototype.complete
    vi.spyOn(Owner.prototype, 'complete').mockImplementation(async function (...args) {
      const receipt = await complete.apply(this, args)
      return { ...receipt, binding: { ...receipt.binding, runtimeSessionId: 'wrong-runtime' } }
    })
  }, ['outcome: wrong receipt runtime'])
})

it('detects a changed command failure code', async () => {
  await detected(
    { ...baseline, fault: 'validation' },
    f => {
      const run = f.runtime().run
      f.runtime().run = async (...args) => {
        try {
          return await run(...args)
        } catch {
          throw createAppError('common.invalid_input')
        }
      }
    },
    ['outcome: expected common.approved_path_required'],
  )
  await detected(
    { ...baseline, event: 'newer', edge: 'identity:before' },
    f => {
      const run = f.runtime().run
      f.runtime().run = async (...args) => {
        try {
          return await run(...args)
        } catch {
          throw createAppError('common.invalid_input')
        }
      }
    },
    ['outcome: unexpected concurrent failure kind'],
  )
})

it('detects wrong tuple and runtime outcomes from cold preparation', async () => {
  await detected(
    { ...baseline, initial: 'owned' },
    f => {
      const run = f.runtime().run
      f.runtime().run = async (...args) => {
        const result = (await run(...args)) as {
          managedClaudeLifecycle: { binding: object }
          managedClaudeBinding: object
        }
        const binding = {
          ...result.managedClaudeBinding,
          tuple: { resumeSessionId: 'wrong', resumeSessionIdVerified: true },
        }
        return {
          ...result,
          sessionId: 'peer-original',
          managedClaudeBinding: binding,
          managedClaudeLifecycle: { ...result.managedClaudeLifecycle, binding },
        }
      }
    },
    ['outcome: wrong prepared tuple', 'outcome: wrong prepared runtime'],
    true,
  )
})

it('detects managed cleanup accidentally introduced on a legacy launch', async () => {
  const reserve = Owner.prototype.reserve
  vi.spyOn(Owner.prototype, 'reserve').mockImplementation(function (id) {
    const attempt = reserve.call(this, id)
    void this.cleanup('original')
    return attempt
  })
  await expect(
    executeLegacyFault({ wrapped: true, enabled: false, provider: 'claude-code', failure: 'none' }),
  ).rejects.toThrow()
})

it('detects a successful receipt with no attributable activation', async () => {
  await detected(baseline, () => {
    const complete = Owner.prototype.complete
    vi.spyOn(Owner.prototype, 'complete').mockImplementation(async function (...args) {
      const receipt = await complete.apply(this, args)
      return { ...receipt, binding: { ...receipt.binding, activationId: 'uncommitted' } }
    })
  }, ['outcome: unattributable receipt'])
})

it('detects a validation failure incorrectly reported as success', async () => {
  await detected(
    { ...baseline, fault: 'validation' },
    f => {
      const run = f.runtime().run
      f.runtime().run = async (...args) => {
        try {
          return await run(...args)
        } catch {
          return {
            sessionId: 'original',
            provider: 'claude-code',
            resumeSessionId: 'original',
            executionContext: { endpoint: { kind: 'local' } },
          }
        }
      }
    },
    ['outcome: expected failure'],
  )
})

it('detects reconciliation that gives up before its read port recovers', async () => {
  await detected(
    { ...baseline, initial: 'fallback', fault: 'activationUnknownCommitted', outageRetries: 4 },
    () => {
      const prototype = Owner.prototype as unknown as {
        scheduleReconciliation(input: object, retry?: number): void
      }
      const schedule = prototype.scheduleReconciliation
      vi.spyOn(prototype, 'scheduleReconciliation').mockImplementation(function (input, retry = 0) {
        if (retry < 3) {
          schedule.call(this, input, retry)
        }
      })
    },
    ['cleanup did not converge'],
  )
})

it('detects loss of candidate hold independently of node-scoped readiness cleanup', async () => {
  const f = await faultHarness(baseline)
  f.pause('agent')
  try {
    const effects =
      await import('../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeAttemptEffects')
    vi.spyOn(effects.ManagedClaudeAttemptEffects.prototype, 'candidateHeld').mockReturnValue(false)
    f.start()
    await f.until(() => f.paused('agent'))
    const candidate = [...f.model.created.keys()][0]
    await f.cleanup(candidate)
    f.release('agent')
    await f.settle()
    expect(f.model.violations.join('\n')).toContain('outcome: expected success')
  } finally {
    f.release('agent')
    f.dispose()
  }
})

it('detects stale-request effects without trusting the owner token guard', async () => {
  await detected(
    { ...baseline, event: 'newer', edge: 'validation:before' },
    () => {
      vi.spyOn(Owner.prototype, 'assertCurrent').mockImplementation(() => {})
    },
    ['effect without independent admission permission'],
  )
})

it('detects failure of an independent peer even when the primary succeeds', async () => {
  await detected(
    { ...baseline, event: 'peerLaunch' },
    f => {
      const run = f.runtime().run
      f.runtime().run = async (...args) => {
        if ((args[1] as { canvasNodeId?: string }).canvasNodeId === 'peer') {
          throw createAppError('agent.launch_failed')
        }
        return run(...args)
      }
    },
    ['outcome: expected independent peer success'],
  )
})
