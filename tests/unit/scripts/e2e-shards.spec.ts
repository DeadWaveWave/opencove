// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  E2E_SHARD_COUNTS,
  fileFilter,
  planShards,
  shardCountFor,
  validatePlan,
} from '../../../scripts/lib/e2e-shards.mjs'
import { shardBaselineFixture } from './fixtures/e2e-shard-baseline'
import { shardInvocation } from '../../../scripts/plan-e2e-shards.mjs'

const id = (file: string, title = 'case') => `tests/e2e/${file}.spec.ts › ${title}`
const file = (name: string) => `tests/e2e/${name}.spec.ts`
const planner = resolve(import.meta.dirname, '../../../scripts/plan-e2e-shards.mjs')
const runPlanner = (...args: string[]) =>
  spawnSync(process.execPath, [planner, ...args], { encoding: 'utf8' })

// Each planner run lists the whole Playwright inventory, which takes seconds on a loaded machine.
describe('E2E shard counts', { timeout: 60_000 }, () => {
  it('has one frozen owner: four Ubuntu shards, three macOS shards', () => {
    expect(E2E_SHARD_COUNTS).toEqual({ ubuntu: 4, macos: 3 })
    expect(Object.isFrozen(E2E_SHARD_COUNTS)).toBe(true)
  })

  it('resolves the count per platform; an explicit override wins; unknown input is refused', () => {
    expect(shardCountFor('ubuntu')).toBe(E2E_SHARD_COUNTS.ubuntu)
    expect(shardCountFor('macos')).toBe(E2E_SHARD_COUNTS.macos)
    expect(shardCountFor('ubuntu', '2')).toBe(2)
    for (const bad of ['0', '-1', '1.5', 'x', '']) {
      expect(() => shardCountFor('ubuntu', bad)).toThrow(/positive integer/)
    }
    expect(() => shardCountFor('windows')).toThrow(/platform/)
  })

  it.each(Object.entries(E2E_SHARD_COUNTS))(
    'plans %s with its own count when --shards is absent',
    (os, count) => {
      const result = runPlanner('--os', os, '--json')
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).shards).toHaveLength(count)
    },
  )

  it('keeps --shards as a local override', () => {
    const result = runPlanner('--os', 'ubuntu', '--shards', '2', '--json')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).shards).toHaveLength(2)
  })

  it('names the platform and its range when a shard index is out of range', () => {
    const result = runPlanner('--os', 'macos', '--shard', String(E2E_SHARD_COUNTS.macos + 1))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `Invalid E2E shard index ${E2E_SHARD_COUNTS.macos + 1} for macos (1..${E2E_SHARD_COUNTS.macos}).`,
    )
    expect(runPlanner('--os', 'macos', '--shard', 'x').stderr).toContain(
      'Invalid E2E shard index x',
    )
  })

  it('--check validates what CI runs and refuses --shards', () => {
    const refused = runPlanner('--check', '--shards', '3')
    expect(refused.status).not.toBe(0)
    expect(refused.stderr).toMatch(/--check.*--shards/)
    const checked = runPlanner('--check')
    expect(checked.status).toBe(0)
    const blocks = Object.fromEntries(
      checked.stdout
        .split('[e2e-shards] ')
        .filter(Boolean)
        .map((block: string) => [block.split(':')[0], block]),
    )
    expect(blocks.ubuntu).toContain('shard 4/4')
    expect(blocks.macos).toContain('shard 3/3')
    expect(blocks.macos).not.toContain('shard 4/4')
  })
})

describe('duration-weighted E2E shards', () => {
  it('uses LPT on whole files, with stable path and shard-index tie breaks', () => {
    const ids = [id('a', 'one'), id('a', 'two'), id('b'), id('c'), id('d')]
    const baseline = Object.fromEntries(ids.map((key, i) => [key, [4, 4, 7, 6, 5][i]]))
    const plan = planShards(ids, baseline, 2)
    expect(plan.shards.map(s => s.files)).toEqual([
      [file('a'), file('d')],
      [file('b'), file('c')],
    ])
    expect(plan.shards.map(s => s.estimatedMs)).toEqual([13, 13])
    expect(planShards([...ids].reverse(), baseline, 2)).toEqual(plan)
    expect(planShards([id('b'), id('a')], {}, 2).shards[0].files).toEqual([file('a')])
  })

  it('estimates new tests/files using the positive OS median; ignores retired IDs as work', () => {
    const plan = planShards(
      [id('known'), id('new'), id('known', 'new')],
      {
        [id('known')]: 10,
        [id('old')]: 30,
        [id('skip')]: 0,
      },
      2,
    )
    expect(plan.defaultMs).toBe(20)
    expect(plan.unknownCases).toBe(2)
    expect(plan.shards.map(s => s.estimatedMs)).toEqual([30, 20])
    expect(planShards([id('new')], {}, 1).defaultMs).toBe(10000)
  })

  it('retains explicit platform-skipped zero-cost cases and distributes zero-cost files', () => {
    const ids = ['a.windows', 'b.windows', 'c.windows', 'd.windows'].map(name => id(name))
    const baseline = Object.fromEntries(ids.map(key => [key, 0]))
    const plan = planShards(ids, baseline, 3)
    expect(plan.shards.map(s => s.estimatedMs)).toEqual([0, 0, 0])
    expect(plan.shards.map(s => s.files.length)).toEqual([2, 1, 1])
    expect(plan.unknownCases).toBe(0)
    expect(() => validatePlan(ids, plan.shards, 3)).not.toThrow()
  })

  it('allows empty shards only when there are fewer files than shards', () => {
    const plan = planShards([id('a'), id('b')], {}, 4)
    expect(plan.shards.map(s => s.files.length)).toEqual([1, 1, 0, 0])
    expect(() => validatePlan([id('a'), id('b')], plan.shards, 4)).not.toThrow()
  })

  it('fails loudly on missing, duplicate, extra files, empty shards and wrong shard counts', () => {
    const ids = [id('a'), id('b'), id('c')]
    const plan = () => planShards(ids, {}, 2).shards
    const missing = plan()
    missing[0].files.pop()
    expect(() => validatePlan(ids, missing, 2)).toThrow(/missing/i)
    const duplicate = plan()
    duplicate[1].files.push(file('a'))
    expect(() => validatePlan(ids, duplicate, 2)).toThrow(/duplicate/i)
    const extra = plan()
    extra[0].files.push(file('unexpected'))
    expect(() => validatePlan(ids, extra, 2)).toThrow(/unexpected/i)
    const empty = plan()
    empty[0].files.push(...empty[1].files)
    empty[1].files = []
    expect(() => validatePlan(ids, empty, 2)).toThrow(/empty/i)
    expect(() => validatePlan(ids, plan(), 3)).toThrow(/count/i)
  })

  it('rejects invalid input instead of silently scheduling an incomplete suite', () => {
    for (const count of [0, -1, 1.5, NaN]) {
      expect(() => planShards([id('a')], {}, count)).toThrow()
    }
    expect(() => planShards([], {}, 3)).toThrow(/empty/i)
    expect(() => planShards([id('a'), id('a')], {}, 3)).toThrow(/duplicate/i)
    expect(() => planShards(['bad'], {}, 3)).toThrow(/ID/)
    for (const value of [-1, NaN, Infinity, null, '20']) {
      expect(() => planShards([id('a')], { [id('a')]: value }, 3)).toThrow(/duration/i)
    }
  })

  it('passes exact literal paths to Playwright, including regex punctuation and spaces', () => {
    const path = 'tests/e2e/nested/file [a]+.spec.ts'
    const pattern = new RegExp(fileFilter(path))
    expect(pattern.test(`/checkout/${path}`)).toBe(true)
    expect(pattern.test(`/checkout/${path}.extra`)).toBe(false)
    expect(pattern.test('/checkout/tests/e2e/nested/file aaaaXspecYts')).toBe(false)
  })

  it('routes files through the existing wrapper, preserving its environment and max-failures', () => {
    const plan = planShards([id('a'), id('b')], {}, 2)
    const env = {
      OPENCOVE_E2E_SKIP_BUILD: '1',
      OPENCOVE_E2E_WINDOW_MODE: 'inactive',
      OPENCOVE_E2E_RETRIES: '0',
      OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
      OPENCOVE_E2E_JSON_REPORT: 'artifacts/e2e-durations/ubuntu-1.json',
    }
    const invocation = shardInvocation(plan, 'ubuntu', 1, 2, env)
    expect(invocation?.args).toEqual(['test:e2e', '--', fileFilter(file('a')), '--max-failures=2'])
    expect(invocation?.env).toMatchObject(env)
    expect(JSON.parse(invocation!.env.OPENCOVE_E2E_SHARD_PLAN)).toEqual({
      os: 'ubuntu',
      current: 1,
      total: 2,
      estimatedMs: 10000,
      files: [file('a')],
    })
    expect(shardInvocation(plan, 'macos', 1, undefined, {}).args).not.toContain('--max-failures=2')
  })

  it('never runs the full suite for an empty shard or an invalid shard selection', () => {
    const plan = planShards([id('a')], {}, 2)
    expect(shardInvocation(plan, 'macos', 2, undefined)).toBeNull()
    expect(() => shardInvocation(plan, 'macos', 0, undefined)).toThrow(/index/)
    expect(() => shardInvocation(plan, 'macos', 1, -1)).toThrow(/max-failures/)
  })

  it.each(['macos', 'ubuntu'])('balances the real %s baseline fixture within 10%%', os => {
    const { ids, baseline } = shardBaselineFixture(os)
    const count = E2E_SHARD_COUNTS[os as 'ubuntu' | 'macos']
    const plan = planShards(ids, baseline, count)
    expect(ids.some(caseId => Object.hasOwn(baseline, caseId))).toBe(true)
    expect(plan.shards.flatMap(s => s.files)).toHaveLength(
      new Set(ids.map(caseId => caseId.split(' › ')[0])).size,
    )
    const costs = plan.shards.map(s => s.estimatedMs)
    expect(Math.max(...costs) / Math.min(...costs)).toBeLessThan(1.1)
    expect(planShards([...ids].reverse(), baseline, count)).toEqual(plan)
    expect(() => validatePlan(ids, plan.shards, count)).not.toThrow()
  })
})
