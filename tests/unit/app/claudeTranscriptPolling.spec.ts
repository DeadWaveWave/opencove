// @vitest-environment node
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { ClaudeHookTranscriptObserver } from '../../../src/app/main/controlSurface/agentHook/ClaudeHookTranscriptObserver'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'

it('idle transcript observation performs zero filesystem calls while active reconciliation polls four times per second', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'claude-polling-'))
  const project = join(root, 'projects', 'p'),
    path = join(project, 'provider.jsonl')
  await fs.mkdir(project, { recursive: true })
  await fs.writeFile(path, '{}\n')
  let tick!: () => void,
    records = 0,
    demand!: (needed: boolean) => void
  const interval = vi.spyOn(globalThis, 'setInterval').mockImplementation(callback => {
    tick = callback as () => void
    return { unref() {} } as ReturnType<typeof setInterval>
  })
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000)
  const emit = (record: ClaudeTranscriptObservation) => {
    if (record.record?.kind === 'checkpoint') {
      records++
      demand = record.setPollingDemand!
    }
  }
  const observer = new ClaudeHookTranscriptObserver(emit, [root])
  try {
    const context = { incarnation: 'inv', isCurrent: () => true }
    const envelope = {
      version: 1 as const,
      state: null,
      hookEventName: 'SessionStart',
      claudeSessionId: 'provider',
      transcriptPath: path,
    }
    observer.observe('s', envelope, context)
    await vi.waitFor(() => expect(records).toBe(1))
    let descriptorStats = 0,
      closes = 0
    const actualOpen = fs.open.bind(fs)
    const open = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await actualOpen(...args),
          stat = handle.stat.bind(handle),
          close = handle.close.bind(handle)
        vi.spyOn(handle, 'stat').mockImplementation(async () => {
          descriptorStats++
          return await stat()
        })
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          closes++
          await close()
        })
        return handle
      }),
      lstat = vi.spyOn(fs, 'lstat'),
      realpath = vi.spyOn(fs, 'realpath')
    clock.mockReturnValue(13000)
    for (let n = 0; n < 4; n++) {
      tick()
    }
    expect(open).not.toHaveBeenCalled()
    expect(lstat).not.toHaveBeenCalled()
    expect(realpath).not.toHaveBeenCalled()
    demand(true)
    for (let n = 0; n < 4; n++) {
      tick()
      await vi.waitFor(() => expect(records).toBe(n + 2))
    }
    expect(open).toHaveBeenCalledTimes(4)
    expect(lstat).toHaveBeenCalledTimes(8)
    expect(realpath).toHaveBeenCalledTimes(8)
    expect(descriptorStats).toBe(8)
    expect(closes).toBe(4)
    demand(false)
    open.mockClear()
    lstat.mockClear()
    realpath.mockClear()
    for (let n = 0; n < 4; n++) {
      tick()
    }
    expect(open).not.toHaveBeenCalled()
    expect(lstat).not.toHaveBeenCalled()
    expect(realpath).not.toHaveBeenCalled()
    observer.observe('s', { ...envelope, hookEventName: 'Stop' }, context)
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    expect(interval).toHaveBeenCalledOnce()
  } finally {
    observer.dispose()
    vi.restoreAllMocks()
    await fs.rm(root, { recursive: true, force: true })
  }
})
