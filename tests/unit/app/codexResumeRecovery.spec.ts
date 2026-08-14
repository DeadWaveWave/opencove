import { describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CodexWriterLockRecoveryExhaustedError,
  isCodexActiveWriterError,
  runCodexResumeWithRetry,
  waitForCodexWriterLockRelease,
  probeCodexWriterLock,
} from '../../../src/app/main/controlSurface/handlers/codexResumeRecovery'

describe('codex resume writer recovery', () => {
  it('passes through immediately when the writer lock is available', async () => {
    const probe = vi.fn(async () => 'available' as const)
    const sleep = vi.fn(async () => undefined)

    await expect(
      waitForCodexWriterLockRelease({
        resumeSessionId: 'thread-1',
        maxWaitMs: 500,
        pollIntervalMs: 100,
        probe,
        sleep,
      }),
    ).resolves.toBe('available')
    expect(probe).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('waits only up to the configured bound while the writer lock remains occupied', async () => {
    let nowMs = 0
    const probe = vi.fn(async () => 'occupied' as const)
    const sleep = vi.fn(async (delayMs: number) => {
      nowMs += delayMs
    })

    await expect(
      waitForCodexWriterLockRelease({
        resumeSessionId: 'thread-1',
        maxWaitMs: 250,
        pollIntervalMs: 100,
        probe,
        sleep,
        now: () => nowMs,
      }),
    ).resolves.toBe('timed_out')
    expect(sleep).toHaveBeenCalledTimes(3)
    expect(nowMs).toBe(250)
  })

  it('continues as soon as an occupied writer lock becomes available', async () => {
    const probe = vi.fn().mockResolvedValueOnce('occupied').mockResolvedValueOnce('available')

    await expect(
      waitForCodexWriterLockRelease({
        resumeSessionId: 'thread-1',
        maxWaitMs: 500,
        pollIntervalMs: 100,
        probe,
        sleep: async () => undefined,
      }),
    ).resolves.toBe('available')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('recognizes both active-writer error signatures', () => {
    expect(isCodexActiveWriterError(new Error('JSON-RPC error -32600'))).toBe(true)
    expect(isCodexActiveWriterError('thread already has an active writer')).toBe(true)
    expect(isCodexActiveWriterError(new Error('executable missing'))).toBe(false)
  })

  it('retries bounded active-writer failures and returns the next successful launch', async () => {
    const launch = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('already has an active writer'))
      .mockRejectedValueOnce(new Error('code -32600'))
      .mockResolvedValueOnce('session-3')
    const sleep = vi.fn(async () => undefined)

    await expect(
      runCodexResumeWithRetry({ launch, maxAttempts: 3, backoffMs: [100, 200], sleep }),
    ).resolves.toBe('session-3')
    expect(launch).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 100)
    expect(sleep).toHaveBeenNthCalledWith(2, 200)
  })

  it('stops at the hard retry limit and preserves the active-writer cause', async () => {
    const launch = vi.fn(async () => {
      throw new Error('thread already has an active writer (-32600)')
    })

    await expect(
      runCodexResumeWithRetry({
        launch,
        maxAttempts: 3,
        backoffMs: [10, 20],
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(CodexWriterLockRecoveryExhaustedError)
    expect(launch).toHaveBeenCalledTimes(3)
  })

  it.skipIf(process.platform !== 'darwin')(
    'observes a real flock holder and waits until the kernel releases it',
    async () => {
      const codexHome = await mkdtemp(join(tmpdir(), 'opencove-codex-writer-lock-'))
      const lockDirectory = join(codexHome, 'thread-writer-locks')
      const lockPath = join(lockDirectory, 'thread-real.lock')
      await mkdir(lockDirectory, { recursive: true })
      const holder = spawn(
        'perl',
        [
          '-MFcntl=:flock',
          '-e',
          '$|=1; open my $fh, ">>", $ARGV[0] or die $!; flock($fh, LOCK_EX) or die $!; print "ready\\n"; select undef, undef, undef, 0.4;',
          lockPath,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )

      try {
        await new Promise<void>((resolvePromise, rejectPromise) => {
          const timer = setTimeout(() => rejectPromise(new Error('flock holder not ready')), 2_000)
          holder.stdout.once('data', () => {
            clearTimeout(timer)
            resolvePromise()
          })
          holder.once('error', rejectPromise)
        })

        await expect(
          probeCodexWriterLock({ resumeSessionId: 'thread-real', codexHome }),
        ).resolves.toBe('occupied')
        await expect(
          waitForCodexWriterLockRelease({
            resumeSessionId: 'thread-real',
            maxWaitMs: 2_000,
            pollIntervalMs: 50,
            probe: async resumeSessionId =>
              await probeCodexWriterLock({ resumeSessionId, codexHome }),
          }),
        ).resolves.toBe('available')
      } finally {
        holder.kill('SIGKILL')
        await rm(codexHome, { recursive: true, force: true })
      }
    },
    5_000,
  )
})
