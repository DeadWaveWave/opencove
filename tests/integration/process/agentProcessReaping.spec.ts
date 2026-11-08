// @vitest-environment node
import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { canReadProcessTable as probeProcessTable } from '../../support/processTableAvailability'
import { isZombieProcess, observedProcessAlive } from '../../support/processLiveness'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  readPosixProcessTable,
  type ProcessIdentity,
} from '../../../src/platform/process/ptyHost/posixProcessTable'
import {
  AGENT_RETIREMENT_BUDGET_MS,
  PTY_HOST_SHUTDOWN_TIMEOUT_MS,
} from '../../../src/platform/process/ptyHost/terminationTiming'
import { PTY_HOST_PROTOCOL_VERSION } from '../../../src/platform/process/ptyHost/protocol'

const canReadProcessTable =
  (process.platform === 'darwin' || process.platform === 'linux') &&
  (await probeProcessTable(readPosixProcessTable))

// Bound from the termination request, rather than restarting a timeout per PID.
const PROCESS_EXIT_MARGIN_MS = 500
const RETIREMENT_POLL_TIMEOUT_MS = AGENT_RETIREMENT_BUDGET_MS + PROCESS_EXIT_MARGIN_MS
const HOST_EXIT_POLL_TIMEOUT_MS = PTY_HOST_SHUTDOWN_TIMEOUT_MS + PROCESS_EXIT_MARGIN_MS

let root: string
let hostEntry: string
beforeAll(async () => {
  if (!canReadProcessTable) {
    return
  }
  root = await mkdtemp(join(tmpdir(), 'opencove-agent-reap-'))
  hostEntry = join(root, 'host.cjs')
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      target: 'node22',
      emptyOutDir: false,
      outDir: root,
      lib: {
        entry: resolve('src/platform/process/ptyHost/entry.ts'),
        formats: ['cjs'],
        fileName: () => 'host.cjs',
      },
      rollupOptions: { external: [/^node:/u, 'node-pty'] },
    },
  })
  await writeFile(
    join(root, 'agent.cjs'),
    `
    const { spawn } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    const child = spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' });
    writeFileSync(process.argv[2], JSON.stringify({ root: process.pid, child: child.pid }));
    process.on('SIGUSR1', () => process.exit(0));
    setInterval(() => {}, 1000);
  `,
  )
})
afterAll(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

async function alive(identity: ProcessIdentity): Promise<boolean | 'unknown'> {
  const sample = await readPosixProcessTable()
  return (
    !isZombieProcess(identity.pid) &&
    observedProcessAlive(
      identity,
      new Map(sample.rows.map(row => [row.pid, row.startTime])),
      sample.complete,
    )
  )
}

// Real host + real node-pty, including session map removal, parent disconnect and shutdown drain.
describe.skipIf(
  !canReadProcessTable || (process.platform !== 'darwin' && process.platform !== 'linux'),
)('Agent PTY process reaping', () => {
  it.each(['close', 'shutdown', 'disconnect', 'SIGTERM', 'naturalExit', 'shell'] as const)(
    'handles %s with a real setsid sleep',
    async mode => {
      const pidFile = join(root, `${mode}.json`)
      // Resolve node-pty from the repository while keeping the generated bundle in tmp.
      const host: ChildProcess = fork(hostEntry, [], {
        env: { ...process.env, NODE_PATH: resolve('node_modules') },
        silent: true,
      })
      const messages: Array<Record<string, unknown>> = []
      let errors = ''
      host.on('message', value => messages.push(value as Record<string, unknown>))
      host.stderr?.on('data', chunk => {
        errors += String(chunk)
      })
      let owned: ProcessIdentity[] = []
      try {
        await expect
          .poll(() => messages.find(message => message.type === 'ready'), {
            timeout: 5_000,
            message: errors,
          })
          .toBeTruthy()
        const ready = messages.find(message => message.type === 'ready')!
        expect(ready.protocolVersion).toBe(PTY_HOST_PROTOCOL_VERSION)
        const hostInstanceId = ready.hostInstanceId
        host.send({
          type: 'spawn',
          hostInstanceId,
          requestId: mode,
          launchId: mode,
          sessionKind: mode === 'shell' ? 'shell' : 'agent',
          command: process.execPath,
          args: [join(root, 'agent.cjs'), pidFile],
          cwd: root,
          env: { ...process.env },
          cols: 80,
          rows: 24,
        })
        await expect
          .poll(
            async () => {
              try {
                return JSON.parse(await readFile(pidFile, 'utf8'))
              } catch {
                return null
              }
            },
            { timeout: 5_000, message: errors },
          )
          .not.toBeNull()
        const pids = JSON.parse(await readFile(pidFile, 'utf8')) as { root: number; child: number }
        owned = (await readPosixProcessTable()).rows.filter(
          row => row.pid === pids.root || row.pid === pids.child,
        )
        expect(owned).toHaveLength(2)
        expect(owned.find(row => row.pid === pids.child)).toMatchObject({
          parentPid: pids.root,
          pgid: pids.child,
        })
        const response = messages.find(message => message.type === 'response')!
        const sessionId = (response.result as { sessionId: string }).sessionId
        if (mode === 'naturalExit') {
          // Give the real shared sampler a lifetime observation before orphaning the tool.
          await new Promise(done => setTimeout(done, 5_200))
          process.kill(pids.root, 'SIGUSR1')
          await expect
            .poll(() => alive(owned.find(row => row.pid === pids.root)!), { timeout: 5_000 })
            .toBe(false)
          expect(await alive(owned.find(row => row.pid === pids.child)!)).toBe(true)
        }
        const terminationStartedAt = Date.now()
        if (mode === 'disconnect') {
          host.disconnect()
        } else if (mode === 'SIGTERM') {
          host.kill('SIGTERM')
        } else {
          host.send({
            type: mode === 'shutdown' ? 'shutdown' : 'kill',
            hostInstanceId,
            ...(mode === 'shutdown' ? {} : { sessionId }),
          })
        }
        const child = owned.find(row => row.pid === pids.child)!
        if (mode === 'shell') {
          await expect
            .poll(() => alive(owned.find(row => row.pid === pids.root)!), {
              timeout: RETIREMENT_POLL_TIMEOUT_MS,
            })
            .toBe(false)
          await new Promise(done => setTimeout(done, 800))
          expect(await alive(child)).toBe(true)
        } else {
          await expect
            .poll(
              async () => {
                const sample = await readPosixProcessTable()
                const current = new Map(sample.rows.map(row => [row.pid, row.startTime]))
                return {
                  survivors: owned
                    .filter(
                      row =>
                        !isZombieProcess(row.pid) &&
                        observedProcessAlive(row, current, sample.complete) !== false,
                    )
                    .map(row => row.pid),
                  hostExitCode: host.exitCode,
                  hostSignal: host.signalCode,
                  stderr: errors,
                }
              },
              {
                timeout: Math.max(
                  1,
                  RETIREMENT_POLL_TIMEOUT_MS - (Date.now() - terminationStartedAt),
                ),
                intervals: [50, 100, 200],
              },
            )
            .toMatchObject({ survivors: [] })
        }
        if (['shutdown', 'disconnect', 'SIGTERM'].includes(mode)) {
          await expect
            .poll(() => host.exitCode, {
              timeout: Math.max(1, HOST_EXIT_POLL_TIMEOUT_MS - (Date.now() - terminationStartedAt)),
              intervals: [50, 100, 200],
            })
            .toBe(0)
        }
        expect(errors).not.toContain('agent reaper')
      } finally {
        // Only exact identities created by this test; never kill by name or the test runner group.
        const cleanupRows = new Map(
          (await readPosixProcessTable()).rows.map(row => [row.pid, row.startTime]),
        )
        for (const identity of owned.reverse()) {
          if (
            !isZombieProcess(identity.pid) &&
            cleanupRows.get(identity.pid) === identity.startTime
          ) {
            process.kill(identity.pid, 'SIGKILL')
          }
        }
        if (host.exitCode === null) {
          host.kill('SIGTERM')
          await new Promise<void>(done => {
            const timer = setTimeout(() => {
              host.kill('SIGKILL')
              done()
            }, PTY_HOST_SHUTDOWN_TIMEOUT_MS)
            host.once('exit', () => {
              clearTimeout(timer)
              done()
            })
          })
        }
      }
    },
    20_000,
  )
})
