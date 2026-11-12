// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
import Database from 'better-sqlite3'
import { describeWithElectronNativeModules } from '../../contract/electronNativeSuite'
import { acquireWorkerSingleInstanceLock } from '../../../src/app/worker/singleInstanceLock'
import { acquireWorkerOwnerLock } from '../../../src/platform/process/workerOwnerLock'

vi.mock('electron', () => ({ app: {} }))
import { repairStaleLocalWorkerFiles } from '../../../src/app/main/worker/localWorkerManager'

describeWithElectronNativeModules('Worker ownership', () => {
  const children: ChildProcess[] = []
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(
      children.splice(0).map(async child => {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit')
          child.kill('SIGKILL')
          await exited
        }
      }),
    )
    await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  async function directory(): Promise<string> {
    await mkdir(resolve('.codex-out/tmp'), { recursive: true })
    const dir = await mkdtemp(resolve('.codex-out/tmp/b1-owner-'))
    directories.push(dir)
    return dir
  }

  async function contender(
    dir: string,
    hold = false,
  ): Promise<{ child: ChildProcess; status: string }> {
    const fixture = await mkdtemp(resolve(dir, 'contender-'))
    const script = resolve(fixture, 'worker.cjs')
    await Promise.all(
      [
        'src/app/worker/singleInstanceLock.ts',
        'src/platform/process/workerOwnerLock.ts',
        'src/platform/process/workerSingleInstanceLockFile.ts',
        'src/platform/process/workerProcessIdentity.ts',
      ].map(async source => {
        const name = source.split('/').at(-1)!.replace('.ts', '.cjs')
        const compiled = ts
          .transpileModule(await readFile(source, 'utf8'), {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2022,
              esModuleInterop: true,
            },
          })
          .outputText.replaceAll(
            '../../platform/process/workerProcessIdentity',
            './workerProcessIdentity.cjs',
          )
          .replaceAll('./workerSingleInstanceLockFile', './workerSingleInstanceLockFile.cjs')
          .replaceAll('../../platform/process/workerOwnerLock', './workerOwnerLock.cjs')
          .replaceAll(
            '../../platform/process/workerSingleInstanceLockFile',
            './workerSingleInstanceLockFile.cjs',
          )
        await writeFile(resolve(fixture, name), compiled)
      }),
    )
    await writeFile(
      script,
      `const { acquireWorkerSingleInstanceLock } = require('./singleInstanceLock.cjs');
    acquireWorkerSingleInstanceLock(process.argv[2]).then(async lock => {
      if (lock.status === 'acquired') {
        const db = new (require('better-sqlite3'))(require('node:path').join(process.argv[2], 'opencove.db'));
        db.pragma('journal_mode = WAL');
        db.exec('CREATE TABLE IF NOT EXISTS writers (pid INTEGER)');
        db.prepare('INSERT INTO writers VALUES (?)').run(process.pid);
        db.close();
        console.log(lock.status);
        if (process.argv[3] === 'hold') setInterval(() => {}, 1000);
        else await lock.release();
      } else console.log(lock.status);
    }).catch(error => { console.error(error); process.exit(1) });`,
    )
    const child = spawn(process.execPath, [script, dir, hold ? 'hold' : 'release'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    let output = ''
    let errors = ''
    child.stdout!.on('data', chunk => {
      output += chunk
    })
    child.stderr!.on('data', chunk => {
      errors += chunk
    })
    await vi.waitFor(
      () => {
        if (child.exitCode && errors) {
          throw new Error(errors)
        }
        expect(output).toMatch(/acquired|existing/u)
      },
      { timeout: 5000 },
    )
    return { child, status: output.trim() }
  }

  it('B1: paused owner survives repair, excludes another process, and SIGKILL releases the kernel lock', async () => {
    const dir = await directory()
    const first = await contender(dir, true)
    expect(first.status).toBe('acquired')
    const metadata = await readFile(resolve(dir, 'opencove-worker.lock'), 'utf8')
    const connection = JSON.stringify({
      version: 1,
      pid: first.child.pid,
      hostname: '127.0.0.1',
      port: 4321,
      token: 'test',
      createdAt: 'test',
      startedBy: 'cli',
    })
    await writeFile(resolve(dir, 'worker-control-surface.json'), connection)
    if (process.platform !== 'win32') {
      first.child.kill('SIGSTOP')
    }
    await Promise.all(
      [first.child.pid, null].map(async pid => {
        expect(await repairStaleLocalWorkerFiles(dir, pid)).toEqual({ status: 'external_owner' })
        expect(await readFile(resolve(dir, 'opencove-worker.lock'), 'utf8')).toBe(metadata)
        expect(await readFile(resolve(dir, 'worker-control-surface.json'), 'utf8')).toBe(connection)
      }),
    )
    expect((await contender(dir)).status).toBe('existing')
    expect(acquireWorkerOwnerLock(dir).status).toBe('busy')
    const persistence = new Database(resolve(dir, 'opencove.db'), { readonly: true })
    try {
      expect(persistence.prepare('SELECT pid FROM writers').all()).toEqual([
        { pid: first.child.pid },
      ])
    } finally {
      persistence.close()
    }
    const exited = once(first.child, 'exit')
    first.child.kill('SIGKILL')
    await exited
    expect((await contender(dir)).status).toBe('acquired')
  }, 15000)

  it('release permits reacquisition and an old release cannot remove newer metadata', async () => {
    const dir = await directory()
    const first = await acquireWorkerSingleInstanceLock(dir)
    expect(first.status).toBe('acquired')
    if (first.status !== 'acquired') {
      return
    }
    await first.release()
    const second = await acquireWorkerSingleInstanceLock(dir)
    expect(second.status).toBe('acquired')
    if (second.status !== 'acquired') {
      return
    }
    try {
      const current = await readFile(resolve(dir, 'opencove-worker.lock'), 'utf8')
      await first.release()
      expect(await readFile(resolve(dir, 'opencove-worker.lock'), 'utf8')).toBe(current)
      const replacement = JSON.stringify({ pid: process.pid, instanceId: 'newer-owner' })
      await writeFile(resolve(dir, 'opencove-worker.lock'), replacement)
      await second.release()
      expect(await readFile(resolve(dir, 'opencove-worker.lock'), 'utf8')).toBe(replacement)
    } finally {
      await second.release()
    }
  })

  it.each([undefined, 'stale-instance'])(
    'recovers an unrelated reused PID (%s)',
    async instanceId => {
      const dir = await directory()
      await writeFile(
        resolve(dir, 'opencove-worker.lock'),
        JSON.stringify({ pid: process.pid, instanceId }),
      )
      const lock = await acquireWorkerSingleInstanceLock(dir)
      expect(lock.status).toBe('acquired')
      if (lock.status === 'acquired') {
        await lock.release()
      }
    },
  )

  it.each(['trailing', 'relative', 'alias', 'delimiter'])(
    'excludes a live legacy Worker using an equivalent path: %s',
    async variant => {
      const root = await directory()
      const dir = resolve(root, 'data -- quoted directory')
      await mkdir(dir)
      const alias = resolve(root, 'alias')
      await symlink(dir, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const userDataArg =
        variant === 'trailing'
          ? `${dir}/`
          : variant === 'relative'
            ? 'data -- quoted directory'
            : variant === 'alias'
              ? alias
              : dir
      const script = resolve(dir, 'worker.js')
      await writeFile(
        script,
        `require('node:fs').writeFileSync(require('node:path').join(process.argv[2], 'opencove-worker.lock'), JSON.stringify({pid: process.pid})); console.log('ready'); setInterval(() => {}, 1000);`,
      )
      const child = spawn(process.execPath, [script, dir, '--user-data', userDataArg], {
        cwd: root,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      children.push(child)
      await once(child.stdout!, 'data')
      const metadata = await readFile(resolve(dir, 'opencove-worker.lock'), 'utf8')
      expect((await acquireWorkerSingleInstanceLock(dir)).status).toBe('existing')
      expect(await repairStaleLocalWorkerFiles(dir, child.pid)).toEqual({
        status: 'external_owner',
      })
      expect(await readFile(resolve(dir, 'opencove-worker.lock'), 'utf8')).toBe(metadata)
    },
  )

  it('simultaneous contenders cannot both replace stale PID metadata', async () => {
    const dir = await directory()
    await writeFile(resolve(dir, 'opencove-worker.lock'), JSON.stringify({ pid: 999_999 }))
    const contenders = await Promise.all([contender(dir, true), contender(dir, true)])
    const acquired = contenders.filter(result => result.status === 'acquired')
    expect(acquired.length).toBeLessThanOrEqual(1)
    // Two SQLite readers upgrading concurrently can both return BUSY. This is safe;
    // after both contenders exit, a fresh attempt must be able to take ownership.
    if (acquired.length === 0) {
      await Promise.all(
        contenders.map(async ({ child }) => {
          if (child.exitCode === null && child.signalCode === null) {
            await once(child, 'exit')
          }
        }),
      )
      expect((await contender(dir, true)).status).toBe('acquired')
    } else {
      expect(contenders.filter(result => result.status === 'existing')).toHaveLength(1)
    }
  })
})
