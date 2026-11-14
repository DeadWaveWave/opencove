// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { resolveDifferentialBaseline } from '../../../scripts/lib/differential-baseline.mjs'

it('skips without touching Git when differential verification was not requested', () => {
  const git = vi.fn(() => {
    throw new Error('Git must not run in ordinary CI')
  })
  expect(resolveDifferentialBaseline(undefined, git)).toMatchObject({
    enabled: false,
    reason: expect.stringContaining('OPENCOVE_DIFFERENTIAL_BASELINE'),
  })
  expect(git).not.toHaveBeenCalled()
})
it('skips with a useful reason when a requested baseline is absent from a shallow checkout', () => {
  const git = vi.fn(() => ({ status: 1, stdout: '' }))
  expect(resolveDifferentialBaseline('missing-baseline', git)).toMatchObject({
    enabled: false,
    reason: expect.stringContaining('Fetch that ref and rerun'),
  })
})
it('pins an available requested ref before the opt-in test starts', () => {
  const commit = 'a'.repeat(40)
  expect(resolveDifferentialBaseline('main', () => ({ status: 0, stdout: `${commit}\n` }))).toEqual(
    { enabled: true, commit },
  )
})
