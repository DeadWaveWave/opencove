// @vitest-environment node
import { lstat, rename } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renameRuntimeDirectory } from '../../../src/app/cli/publishRuntime.mjs'

vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  rename: vi.fn(),
  lstat: vi.fn(),
}))

const nativePlatform = process.platform
const failure = (code: string) => Object.assign(new Error(`rename failed: ${code}`), { code })

describe('runtime publication rename', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] })
    Object.defineProperty(process, 'platform', { value: 'win32' })
    vi.mocked(rename).mockReset().mockResolvedValue(undefined)
    vi.mocked(lstat).mockReset().mockRejectedValue(failure('ENOENT'))
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: nativePlatform })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    'retries temporary %s without changing paths',
    async code => {
      vi.mocked(rename).mockRejectedValueOnce(failure(code)).mockRejectedValueOnce(failure(code))
      const result = expect(
        renameRuntimeDirectory('staging', 'destination'),
      ).resolves.toBeUndefined()
      await Promise.all([result, vi.runAllTimersAsync()])
      expect(vi.mocked(rename).mock.calls).toEqual([
        ['staging', 'destination'],
        ['staging', 'destination'],
        ['staging', 'destination'],
      ])
      expect(performance.now()).toBe(30)
      expect(process.stderr.write).toHaveBeenCalledTimes(2)
      expect(vi.mocked(process.stderr.write).mock.calls[0][0]).toContain(code)
      expect(vi.mocked(process.stderr.write).mock.calls[0][0]).toContain('10ms')
      expect(vi.mocked(process.stderr.write).mock.calls[1][0]).toContain('20ms')
    },
  )

  it('stops at 60 seconds and preserves the original error object', async () => {
    const original = failure('EPERM')
    vi.mocked(rename).mockRejectedValue(failure('EPERM')).mockRejectedValueOnce(original)
    const result = expect(renameRuntimeDirectory('staging', 'repair')).rejects.toBe(original)
    await Promise.all([result, vi.runAllTimersAsync()])
    expect(performance.now()).toBe(60_000)
    expect(rename).toHaveBeenCalledTimes(605)
    expect(process.stderr.write).toHaveBeenCalledTimes(605)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails immediately for a non-transient error', async () => {
    const error = failure('EXDEV')
    vi.mocked(rename).mockRejectedValue(error)
    await expect(renameRuntimeDirectory('staging', 'destination')).rejects.toBe(error)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(process.stderr.write).not.toHaveBeenCalled()
    expect(lstat).not.toHaveBeenCalled()
  })

  it('does not retry permission errors on other platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const error = failure('EPERM')
    vi.mocked(rename).mockRejectedValue(error)
    await expect(renameRuntimeDirectory('staging', 'destination')).rejects.toBe(error)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(process.stderr.write).not.toHaveBeenCalled()
  })

  it('returns destination conflicts to the existing reuse/repair protocol immediately', async () => {
    const error = failure('EPERM')
    vi.mocked(rename).mockRejectedValue(error)
    vi.mocked(lstat).mockResolvedValue({} as Awaited<ReturnType<typeof lstat>>)
    await expect(renameRuntimeDirectory('staging', 'destination')).rejects.toBe(error)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(process.stderr.write).not.toHaveBeenCalled()
  })
})
