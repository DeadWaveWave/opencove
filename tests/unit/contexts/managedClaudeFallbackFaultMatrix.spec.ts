// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { fallbackFaultHarness } from './managedClaudeFallbackFaultHarness'
import { shellFaults, shellEvents, type ShellCase } from './managedClaudeFallbackFaultCases'
import { fallbackSteps } from './managedClaudeFaultModel'

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))
vi.mock('../../../src/platform/terminal/TerminalProfileResolver', () => ({
  TerminalProfileResolver: class {
    async resolveTerminalSpawn() {
      throw new Error('unconfigured profile')
    }
  },
}))
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const cases: ShellCase[] = (['plain', 'mount'] as const).flatMap(route =>
  (['stopped', 'failedResume'] as const).flatMap(mode =>
    (['hold', 'persist'] as const).flatMap(handoff =>
      shellFaults.flatMap(fault =>
        shellEvents.flatMap(event =>
          fallbackSteps.flatMap(step =>
            (['before', 'after'] as const)
              .filter(side => event !== 'none' || (step === 'shellProfile' && side === 'before'))
              .map(side => ({
                route,
                mode,
                handoff,
                fault,
                event,
                edge: `${step}:${side}` as const,
              })),
          ),
        ),
      ),
    ),
  ),
)
const selected =
  process.env.OPENCOVE_FALLBACK_FAULT_CASES === 'eventless'
    ? cases.filter(value => value.event === 'none')
    : cases
const coverage: (ShellCase & { faultReached: boolean; eventReached: boolean })[] = []
afterAll(() => {
  if (process.env.OPENCOVE_FALLBACK_FAULT_COVERAGE) {
    writeFileSync(process.env.OPENCOVE_FALLBACK_FAULT_COVERAGE, JSON.stringify(coverage))
  }
  if (coverage.length !== cases.length) {
    return
  }
  for (const fault of shellFaults.filter(value => value !== 'none')) {
    expect(
      coverage.some(value => value.fault === fault && value.faultReached),
      fault,
    ).toBe(true)
  }
  for (const event of shellEvents.filter(value => value !== 'none')) {
    for (const step of fallbackSteps) {
      for (const side of ['before', 'after'] as const) {
        expect(
          coverage.some(
            value =>
              value.event === event && value.edge === `${step}:${side}` && value.eventReached,
          ),
          `${event}/${step}:${side}`,
        ).toBe(true)
      }
    }
  }
})
describe('managed Claude fallback shell fault matrix', () => {
  it.each(selected)('$route / $mode / $handoff / $fault / $event at $edge', async config => {
    const f = await fallbackFaultHarness(config)
    try {
      f.start()
      await f.settle()
      coverage.push({ ...config, ...f.coverage() })
      if (f.models.some(model => model.violations.length)) {
        throw new Error(f.models.flatMap(model => model.violations).join('\n'))
      }
      f.models.forEach(model => model.assertValid())
    } finally {
      f.dispose()
    }
  })
})
