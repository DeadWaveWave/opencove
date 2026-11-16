// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  acquireHomeWorkerConfigLease,
  HOME_WORKER_CONFIG_LEASE_FILE,
  HOME_WORKER_CONFIG_LEASE_OWNER_FILE,
} from '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'
import {
  createUserDataPath,
  ownerPath,
  registerHomeWorkerConfigLeaseCases,
} from './homeWorkerConfigLease.helpers'

// The lease is plain Node file I/O, so the contenders run under the Node that runs Vitest.
type ContenderMessage = { type: string; t?: number; code?: string | null; message?: string }
type Contender = {
  child: ChildProcess
  messages: ContenderMessage[]
  stderr: () => string
  exited: Promise<unknown>
  send: (command: Record<string, unknown>) => void
  next: (type: string, timeoutMs?: number) => Promise<ContenderMessage>
}

registerHomeWorkerConfigLeaseCases()

describe('Home Worker configuration lease across real processes', () => {
  let buildRoot = ''
  const contenders: Contender[] = []

  beforeAll(async () => {
    buildRoot = await mkdtemp(join(tmpdir(), 'opencove-lease-contender-'))
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        target: 'node22',
        outDir: join(buildRoot, 'build'),
        lib: {
          entry: resolve('tests/unit/contexts/fixtures/homeWorkerConfigLeaseContender.fixture.ts'),
          formats: ['es'],
          fileName: () => 'fixture.mjs',
        },
        rollupOptions: { external: id => id.startsWith('node:') },
      },
    })
  }, 60_000)

  afterEach(async () => {
    for (const contender of contenders.splice(0)) {
      if (contender.child.exitCode === null && contender.child.signalCode === null) {
        contender.child.kill('SIGKILL')
      }
      await contender.exited
    }
  })

  afterAll(async () => {
    await rm(buildRoot, { recursive: true, force: true })
  })

  async function startContender(userDataPath: string): Promise<Contender> {
    const child = spawn(process.execPath, [join(buildRoot, 'build/fixture.mjs'), userDataPath], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    const exited = once(child, 'exit')
    const messages: ContenderMessage[] = []
    let stderrText = ''
    child.stderr?.on('data', chunk => {
      stderrText += String(chunk)
    })
    child.stdout?.resume()
    child.on('message', message => messages.push(message as ContenderMessage))
    const consumed = new Set<ContenderMessage>()
    const contender: Contender = {
      child,
      messages,
      stderr: () => stderrText,
      exited,
      send: command => {
        child.send(command)
      },
      next: async (type, timeoutMs = 10_000) => {
        const startedAt = Date.now()
        for (;;) {
          const found = messages.find(message => !consumed.has(message) && message.type === type)
          if (found) {
            consumed.add(found)
            return found
          }
          const failure = messages.find(
            message => !consumed.has(message) && message.type === 'error' && type !== 'error',
          )
          if (failure) {
            throw new Error(`Contender reported ${failure.code}: ${failure.message}`)
          }
          if (Date.now() - startedAt > timeoutMs) {
            throw new Error(`Contender did not report "${type}" within ${timeoutMs} ms`)
          }
          await new Promise(resolvePromise => setTimeout(resolvePromise, 10))
        }
      },
    }
    contenders.push(contender)
    await contender.next('ready')
    return contender
  }

  // Written straight to stdout so the line reaches the CI log whole; the lint rule bans console.
  function recordResult(line: string): void {
    process.stdout.write(`${line}\n`)
  }

  function errorCode(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code
    return typeof code === 'string' ? code : 'none'
  }

  async function renameCode(from: string, to: string): Promise<string> {
    try {
      await rename(from, to)
      return 'none'
    } catch (error) {
      return errorCode(error)
    }
  }

  // The failure of #717: the rename of a new claim directory onto a free lease path was refused.
  // This repeats the lease's own claim sequence and records how often that happens here, with
  // which code, and how long it lasts.
  it.runIf(process.platform === 'win32')(
    'W0 records how often a claim renamed onto a free lease path is refused, and for how long',
    async () => {
      const userDataPath = await createUserDataPath()
      const attempts = 300
      const codes = new Map<string, number>()
      let refused = 0
      let recovered = 0
      let longestRecoveryMs = 0

      for (let index = 0; index < attempts; index += 1) {
        const lease = resolve(userDataPath, `${HOME_WORKER_CONFIG_LEASE_FILE}-w0-${index}`)
        const claim = `${lease}.claim`
        await mkdir(claim)
        await writeFile(resolve(claim, HOME_WORKER_CONFIG_LEASE_OWNER_FILE), '{"pid":1}\n', {
          encoding: 'utf8',
          mode: 0o600,
        })
        let code = await renameCode(claim, lease)
        if (code === 'none') {
          continue
        }

        refused += 1
        codes.set(code, (codes.get(code) ?? 0) + 1)
        const startedAt = Date.now()
        while (code !== 'none' && Date.now() - startedAt < 5_000) {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
          code = await renameCode(claim, lease)
        }
        if (code === 'none') {
          recovered += 1
          longestRecoveryMs = Math.max(longestRecoveryMs, Date.now() - startedAt)
        }
      }

      recordResult(
        `[lease-windows] W0 plain-claim attempts=${attempts} refused=${refused} codes=${JSON.stringify(Object.fromEntries(codes))} recovered=${recovered} longestRecoveryMs=${longestRecoveryMs}`,
      )
      // A refusal that does not end within the lease's deadline is not something a retry can fix.
      expect(recovered).toBe(refused)
    },
    120_000,
  )

  it.runIf(process.platform === 'win32')(
    'W1 records the code of a claim renamed onto a held lease directory',
    async () => {
      const userDataPath = await createUserDataPath()
      const lease = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
      const claim = `${lease}.claim-w1`
      await mkdir(lease)
      await writeFile(ownerPath(userDataPath), '{}\n')
      await mkdir(claim)
      await writeFile(resolve(claim, HOME_WORKER_CONFIG_LEASE_OWNER_FILE), '{}\n')

      const code = await renameCode(claim, lease)

      recordResult(`[lease-windows] W1 claim-onto-held-directory code=${code}`)
      expect(code).toBe('EPERM')
    },
    20_000,
  )

  it.runIf(process.platform === 'win32')(
    'W1b records the code of a claim renamed onto a legacy lease file',
    async () => {
      const userDataPath = await createUserDataPath()
      const lease = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
      const claim = `${lease}.claim-w1b`
      await writeFile(lease, '{}\n')
      await mkdir(claim)
      await writeFile(resolve(claim, HOME_WORKER_CONFIG_LEASE_OWNER_FILE), '{}\n')

      const code = await renameCode(claim, lease)

      recordResult(`[lease-windows] W1b claim-onto-legacy-file code=${code}`)
      expect(code).toBe('EPERM')
    },
    20_000,
  )

  it.runIf(process.platform === 'win32')(
    'W2 records the code of renaming a lease away while another process has owner.json open',
    async () => {
      const userDataPath = await createUserDataPath()
      const lease = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
      const away = `${lease}.release-w2`
      await mkdir(lease)
      await writeFile(ownerPath(userDataPath), '{}\n')
      const reader = await startContender(userDataPath)
      reader.send({ type: 'hold-open', path: ownerPath(userDataPath) })
      await reader.next('holding')

      const code = await renameCode(lease, away)

      recordResult(
        `[lease-windows] W2 rename-away-with-open-owner renamed=${code === 'none'} code=${code}`,
      )
      reader.send({ type: 'close-hold' })
      await reader.next('closed')
    },
    30_000,
  )

  it('W3 serializes two real processes until the holder releases', async () => {
    const userDataPath = await createUserDataPath()
    const first = await startContender(userDataPath)
    const second = await startContender(userDataPath)
    first.send({ type: 'acquire' })
    await first.next('acquired')

    second.send({ type: 'acquire' })
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
    first.send({ type: 'release' })
    const released = await first.next('released')
    const acquired = await second.next('acquired')

    expect(acquired.t).toBeGreaterThanOrEqual(released.t!)
    second.send({ type: 'release' })
    await second.next('released')
    expect(second.stderr()).toBe('')
    for (const contender of [first, second]) {
      contender.child.disconnect()
      expect(await contender.exited).toEqual([0, null])
    }
  }, 30_000)

  it('W4 reclaims a lease whose owner process was killed', async () => {
    const userDataPath = await createUserDataPath()
    const first = await startContender(userDataPath)
    first.send({ type: 'acquire' })
    await first.next('acquired')
    first.child.kill()
    await first.exited

    const lease = await acquireHomeWorkerConfigLease(userDataPath, {
      timeoutMs: 5_000,
      dependencies: { token: () => 'reclaiming-owner' },
    })

    expect(await readFile(ownerPath(userDataPath), 'utf8')).toContain('reclaiming-owner')
    await lease.release()
  }, 30_000)

  it('W5 releases while another process has owner.json open', async () => {
    const userDataPath = await createUserDataPath()
    const lockPath = resolve(userDataPath, HOME_WORKER_CONFIG_LEASE_FILE)
    const holder = await acquireHomeWorkerConfigLease(userDataPath, {
      dependencies: { token: () => 'releasing-owner' },
    })
    const reader = await startContender(userDataPath)
    reader.send({ type: 'hold-open', path: ownerPath(userDataPath), ms: 300 })
    await reader.next('holding')

    await holder.release()

    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const next = await acquireHomeWorkerConfigLease(userDataPath, {
      timeoutMs: 1_000,
      dependencies: { token: () => 'next-owner' },
    })
    await next.release()
  }, 30_000)
})
