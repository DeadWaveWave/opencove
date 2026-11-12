// @vitest-environment node
import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isZombieProcess } from '../../support/processLiveness'
import { expect, it } from 'vitest'
import {
  AgentProcessReaper,
  type ProcessIdentity,
} from '../../../src/platform/process/ptyHost/agentProcessReaper'

function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return !isZombieProcess(pid)
  } catch {
    return false
  }
}

// This sandbox permits child processes and signals but denies ps. Exercise real POSIX
// signals with exact fixture-owned membership; the real ps + host suite lives next door.
it.skipIf(process.platform === 'win32').each(['agent', 'shell', 'exitedAgent'] as const)(
  '%s policy with a real detached child (injected fixture identities)',
  async kind => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-reap-signals-'))
    const script = join(root, 'root.cjs')
    await writeFile(
      script,
      `
      const { spawn } = require('node:child_process');
      const child = spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' });
      child.on('spawn', () => process.send({ root: process.pid, child: child.pid }));
      setInterval(() => {}, 1000);
    `,
    )
    const child: ChildProcess = fork(script, [], { silent: true })
    let owned: number[] = [child.pid!]
    const exited = new Promise<void>(done => child.once('exit', () => done()))
    try {
      const pids = await new Promise<{ root: number; child: number }>((done, reject) => {
        const timer = setTimeout(() => reject(new Error('fixture startup timed out')), 3_000)
        child.once('message', value => {
          clearTimeout(timer)
          done(value as { root: number; child: number })
        })
        child.once('error', error => {
          clearTimeout(timer)
          reject(error)
        })
      })
      owned = [pids.root, pids.child]
      const table: ProcessIdentity[] = [
        {
          pid: pids.root,
          parentPid: process.pid,
          pgid: pids.root,
          startTime: 'fixture-root',
          command: 'node',
        },
        {
          pid: pids.child,
          parentPid: pids.root,
          pgid: pids.child,
          startTime: 'fixture-sleep',
          command: 'sleep',
        },
      ]
      const reaper = new AgentProcessReaper({
        readTable: async () => ({ rows: table.filter(row => running(row.pid)), complete: true }),
      })
      if (kind !== 'shell') {
        await reaper.track('fixture', pids.root)
        if (kind === 'exitedAgent') {
          child.kill('SIGHUP')
          await exited
          reaper.noteExit('fixture')
          expect(running(pids.child)).toBe(true)
        }
        await reaper.terminate('fixture', () => {
          child.kill('SIGHUP')
        })
      } else {
        child.kill('SIGHUP')
      }
      await exited
      if (kind !== 'shell') {
        await expect.poll(() => running(pids.child), { timeout: 3_000 }).toBe(false)
      } else {
        await new Promise(done => setTimeout(done, 800))
        expect(running(pids.child)).toBe(true)
      }
    } finally {
      for (const pid of owned.reverse()) {
        if (running(pid)) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            /* Already exited. */
          }
        }
      }
      await exited
      await rm(root, { recursive: true, force: true })
    }
  },
  10_000,
)
