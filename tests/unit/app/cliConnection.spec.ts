import { expect, it, vi } from 'vitest'
import { resolveConnection } from '../../../src/app/cli/core/context'
import type { CliIo } from '../../../src/app/cli/core/io'
function fixture(worker = false) {
  const readTextFile = vi.fn(async (file: string) => {
    expect(file.startsWith('/isolated/')).toBe(true)
    if (worker !== file.endsWith('worker-control-surface.json')) {
      throw Error('ENOENT')
    }
    return JSON.stringify({
      version: 1,
      pid: 4242,
      hostname: '127.0.0.1',
      port: 4312,
      token: 'token',
      createdAt: '2026-04-26T02:10:00Z',
    })
  })
  const io: CliIo = {
    env: { OPENCOVE_USER_DATA_DIR: '/isolated' },
    readTextFile,
    readStdinText: async () => '',
    now: Date.now,
    fetch: vi.fn(),
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
    isProcessAlive: () => true,
    profileCandidates: () => ['/must-not-read'],
  }
  return { io, readTextFile }
}
it.each([false, true])('resolves explicit profile including worker fallback %s', async worker => {
  const f = fixture(worker)
  expect(await resolveConnection({}, f.io)).toMatchObject({
    endpoint: 'http://127.0.0.1:4312',
    token: 'token',
  })
  expect(f.readTextFile).toHaveBeenCalledTimes(2)
})
it('does not fall back outside an explicit profile when files are missing', async () => {
  const f = fixture()
  f.readTextFile.mockRejectedValue(Error('ENOENT'))
  await expect(resolveConnection({}, f.io)).rejects.toMatchObject({ exitCode: 3 })
  expect(f.readTextFile).toHaveBeenCalledTimes(2)
})
