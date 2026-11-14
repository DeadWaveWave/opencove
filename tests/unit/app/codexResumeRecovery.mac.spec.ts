import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  probeCodexWriterLock,
  waitForCodexWriterLockRelease,
} from '../../../src/app/main/controlSurface/handlers/codexResumeRecovery'

describe('codex resume writer recovery (macOS)', () => {
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
          '$|=1; open my $fh, ">>", $ARGV[0] or die $!; flock($fh, LOCK_EX) or die $!; print "ready\\n"; select undef, undef, undef, 3;',
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
            maxWaitMs: 5_000,
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
    8_000,
  )
})
