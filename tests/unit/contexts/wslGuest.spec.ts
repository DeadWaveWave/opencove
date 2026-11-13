// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { findWslGuest } from '../../support/wslGuest'

it('selects an installed guest and verifies it can start before running the receiver', () => {
  const run = vi
    .fn()
    .mockReturnValueOnce('U\0b\0u\0n\0t\0u\0\r\0\n\0Debian\r\n')
    .mockReturnValueOnce('')
  expect(findWslGuest('Ubuntu', run)).toEqual({ distro: 'Ubuntu' })
  expect(run.mock.calls).toEqual([
    ['wsl.exe', ['--list', '--quiet']],
    ['wsl.exe', ['--distribution', 'Ubuntu', '--exec', '/bin/true']],
  ])
})
it('automatically selects an available guest when no distribution was configured', () => {
  expect(findWslGuest('', vi.fn().mockReturnValueOnce('Ubuntu\n').mockReturnValueOnce(''))).toEqual(
    { distro: 'Ubuntu' },
  )
})
it.each(['missing executable', 'disabled feature', 'probe timeout'])(
  'reports an honest skip for %s',
  () => {
    const run = vi.fn(() => {
      throw new Error('unavailable')
    })
    expect(findWslGuest('', run)).toMatchObject({
      skipReason: expect.stringContaining('cannot list'),
    })
  },
)
it('does not replace a configured but missing distribution with another one', () => {
  const run = vi.fn().mockReturnValue('Debian\n')
  expect(findWslGuest('Ubuntu', run)).toMatchObject({
    skipReason: expect.stringContaining('not installed'),
  })
  expect(run).toHaveBeenCalledOnce()
})
it('reports no guest and an unavailable guest separately', () => {
  expect(findWslGuest('', vi.fn().mockReturnValue(''))).toMatchObject({
    skipReason: expect.stringContaining('No WSL distribution'),
  })
  const run = vi
    .fn()
    .mockReturnValueOnce('Ubuntu\n')
    .mockImplementationOnce(() => {
      throw new Error('WSL cannot start')
    })
  expect(findWslGuest('Ubuntu', run)).toMatchObject({
    skipReason: expect.stringContaining('cannot start'),
  })
})
