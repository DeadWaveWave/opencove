// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalFileSystemPort } from '../../../src/contexts/filesystem/infrastructure/localFileSystemPort'
import { toAppErrorDescriptor } from '../../../src/shared/errors/appError'

const { stat } = vi.hoisted(() => ({ stat: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const routedStat = (path: Parameters<typeof actual.stat>[0]) =>
    String(path).replace(/\\/g, '/').endsWith('/repo/a.ts') ? stat(path) : actual.stat(path)
  return { ...actual, default: { ...actual, stat: routedStat }, stat: routedStat }
})
beforeEach(() => {
  stat.mockReset()
})

describe('filesystem stat error identity for terminal links', () => {
  it.each([
    ['ENOENT', 'not_found'],
    ['ENOTDIR', 'not_found'],
    ['EACCES', 'forbidden'],
    ['EPERM', 'forbidden'],
    ['EIO', 'unavailable'],
  ])('preserves %s as structured %s across an error envelope', async (code, reason) => {
    stat.mockRejectedValue(Object.assign(new Error('filesystem failure'), { code }))
    const error = await createLocalFileSystemPort()
      .stat({ uri: 'file:///repo/a.ts' })
      .catch(failure => failure)
    const descriptor = toAppErrorDescriptor(error, 'common.unexpected')
    expect(JSON.parse(JSON.stringify(descriptor))).toMatchObject({
      code: 'filesystem.stat_failed',
      params: { reason },
    })
  })

  it('still reports the verified filesystem kind and metadata on success', async () => {
    stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, size: 12, mtimeMs: 34 })
    expect(await createLocalFileSystemPort().stat({ uri: 'file:///repo/a.ts' })).toEqual({
      uri: 'file:///repo/a.ts',
      kind: 'file',
      sizeBytes: 12,
      mtimeMs: 34,
    })
  })
})
