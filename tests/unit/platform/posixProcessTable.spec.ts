// @vitest-environment node
import { execFile } from 'node:child_process'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  parseProcessTable,
  readPosixProcessTable,
} from '@platform/process/ptyHost/posixProcessTable'
import { canReadProcessTable } from '../../support/processTableAvailability'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
beforeEach(() => {
  vi.mocked(execFile).mockReset()
})
const output = '20 10 20 Mon Nov  9 12:00:00 2026 Ss /bin/sleep 30\n'
function respond(error: Error | null, stdout = output) {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void
    callback(error, stdout, '')
    return {} as ReturnType<typeof execFile>
  })
}
it('bounds an async whole-table read with command, normalized locale/timezone, and abort support', async () => {
  respond(null)
  const signal = new AbortController().signal
  expect(await readPosixProcessTable(signal)).toEqual([
    {
      pid: 20,
      parentPid: 10,
      pgid: 20,
      startTime: 'Mon Nov 9 12:00:00 2026',
      state: 'Ss',
      command: '/bin/sleep 30',
    },
  ])
  expect(execFile).toHaveBeenCalledWith(
    '/bin/ps',
    ['-ax', '-o', 'pid=,ppid=,pgid=,lstart=,stat=,command='],
    expect.objectContaining({
      timeout: 400,
      signal,
      maxBuffer: 4 * 1024 * 1024,
      env: expect.objectContaining({ LC_ALL: 'C', TZ: 'UTC' }),
    }),
    expect.any(Function),
  )
})
it('rejects adapter failures rather than interpreting failed output as a valid empty table', async () => {
  respond(new Error('adapter broken'))
  await expect(readPosixProcessTable()).rejects.toThrow('adapter broken')
})
it('parses valid kernel/init rows without mistaking them for malformed stdout', () => {
  expect(parseProcessTable(`${output}1 0 1 Mon Nov 9 12:00:00 2026 S init\n`)).toHaveLength(2)
})
it.each(['', '  \n', 'entirely malformed\n', `${output}20 incomplete\n`])(
  'rejects incomplete or empty table output: %j',
  async stdout => {
    respond(null, stdout)
    await expect(readPosixProcessTable()).rejects.toThrow(/process table/iu)
  },
)
it('only permits code EPERM as an integration skip', async () => {
  expect(
    await canReadProcessTable(async () => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' })
    }),
  ).toBe(false)
})
it.each([
  { code: 'EACCES', stderr: 'Permission denied' },
  { code: 1, stderr: 'ps: Operation not permitted' },
  { code: 'ENOENT' },
  { code: 'ETIMEDOUT' },
])('does not hide adapter failures as permission skips: %j', async failure => {
  await expect(
    canReadProcessTable(async () => {
      throw failure
    }),
  ).rejects.toBe(failure)
})
