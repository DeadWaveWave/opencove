// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { faultHarness } from './managedClaudeFaultHarness'
import { faults, steps, type FaultCase, type ConcurrentEvent } from './managedClaudeFaultModel'

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))

const events: ConcurrentEvent[] = ['none', 'delete', 'newer', 'prepare', 'restart']
const allCases: FaultCase[] = faults.flatMap(fault =>
  events.flatMap(event =>
    steps.flatMap(step =>
      (['before', 'after'] as const).flatMap(side =>
        (['owned', 'fallback', 'adoption'] as const).map(initial => ({
          fault,
          event,
          edge: `${step}:${side}` as const,
          initial,
        })),
      ),
    ),
  ),
)
const cases =
  process.env.OPENCOVE_FAULT_CASES === 'smoke'
    ? allCases.filter(
        value =>
          value.initial === 'owned' &&
          value.event === 'none' &&
          value.edge === 'identity:before' &&
          ['validation', 'admissionKill', 'registration'].includes(value.fault),
      )
    : process.env.OPENCOVE_FAULT_CASES === 'eventless'
      ? allCases.filter(value => value.event === 'none' && value.edge === 'identity:before')
      : allCases.filter(value => value.event !== 'none' || value.edge === 'identity:before')
const coverage: {
  faultReached: boolean
  eventReached: boolean
  fault: string
  event: string
  edge: string
}[] = []
afterAll(() => {
  if (process.env.OPENCOVE_FAULT_COVERAGE_PATH) {
    writeFileSync(process.env.OPENCOVE_FAULT_COVERAGE_PATH, JSON.stringify(coverage, null, 2))
  }
  if (coverage.length === cases.length && !process.env.OPENCOVE_FAULT_CASES) {
    for (const fault of faults.filter(value => value !== 'none')) {
      expect(
        coverage.some(value => value.fault === fault && value.faultReached),
        fault,
      ).toBe(true)
    }
    for (const event of events.filter(value => value !== 'none')) {
      for (const step of steps) {
        for (const side of ['before', 'after']) {
          const edge = `${step}:${side}`
          expect(
            coverage.some(
              value => value.event === event && value.edge === edge && value.eventReached,
            ),
            `${event}:${edge}`,
          ).toBe(true)
        }
      }
    }
  }
})

describe('managed Claude owner and wrapper fault matrix', () => {
  it.each(cases)(
    '$initial / $fault / $event at $edge',
    async config => {
      const f = await faultHarness(config)
      try {
        f.start()
        await f.settle()
        coverage.push({
          ...config,
          ...f.coverage(),
          steps: f.model.trace.length,
          violations: f.model.violations,
        })
        f.model.assertValid()
      } finally {
        f.dispose()
      }
    },
    5000,
  )

  it('preserves the complete pre-admission binding and process after path approval fails', async () => {
    const f = await faultHarness({
      initial: 'owned',
      fault: 'validation',
      event: 'none',
      edge: 'identity:before',
    })
    const before = f.model.observation('agent')
    try {
      f.start()
      await f.completePrimary()
      expect(f.primary()).toMatchObject({
        ok: false,
        error: { code: 'common.approved_path_required' },
      })
      expect(f.model.observation('agent')).toEqual(before)
      expect([...f.model.alive.keys()]).toEqual(['original'])
      expect(f.model.killAttempts.size).toBe(0)
      expect(f.pending()).toEqual([])
      await f.settle()
      f.model.assertValid()
    } finally {
      f.dispose()
    }
  })

  it('retains the failed predecessor kill through wrapper settlement until the next request retries', async () => {
    const f = await faultHarness({
      initial: 'owned',
      fault: 'admissionKill',
      event: 'none',
      edge: 'identity:before',
    })
    try {
      f.start()
      await f.completePrimary()
      expect(f.primary()).toMatchObject({ ok: false, error: { code: 'agent.launch_failed' } })
      expect(f.model.observation('agent')).toMatchObject({
        nodeRuntimeSessionId: null,
        binding: { runtimeSessionId: null },
      })
      expect([...f.model.alive.keys()]).toEqual(['original'])
      expect(f.model.killAttempts.get('original')).toBe(1)
      expect(f.pending()).toEqual(['original'])
      await f.settle()
      expect(f.model.killAttempts.get('original')).toBe(2)
      expect(f.model.alive.size).toBe(0)
      expect(f.pending()).toEqual([])
      f.model.assertValid()
    } finally {
      f.dispose()
    }
  })
})
