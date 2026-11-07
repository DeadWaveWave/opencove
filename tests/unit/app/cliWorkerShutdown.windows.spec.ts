// @vitest-environment node
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { expect, it } from 'vitest'
import { WORKER_PARENT_SHUTDOWN } from '../../../src/shared/runtime/workerParentShutdown'
import { resolveWorkerSingleInstanceLockPath } from '../../../src/platform/process/workerSingleInstanceLockFile'

// The Worker owner lock is held through better-sqlite3, which is built for Electron's ABI, so the
// fixture runs in Electron's Node mode and loads the native module from this checkout.
const requireFromHere = createRequire(import.meta.url)
const electronPath = requireFromHere('electron') as unknown as string
const betterSqliteUrl = pathToFileURL(requireFromHere.resolve('better-sqlite3')).href

it('Windows IPC shutdown drains accepted work and releases the Worker lock before exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-shutdown-'))
  let child: ReturnType<typeof spawn> | undefined
  let exited: Promise<unknown> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        target: 'node22',
        outDir: join(root, 'build'),
        lib: {
          entry: resolve('tests/unit/app/fixtures/workerParentShutdown.fixture.ts'),
          formats: ['es'],
          fileName: () => 'fixture.mjs',
        },
        rollupOptions: {
          external: id => id.startsWith('node:') || id === 'better-sqlite3',
          output: { paths: { 'better-sqlite3': betterSqliteUrl } },
        },
      },
    })
    child = spawn(electronPath, [join(root, 'build/fixture.mjs'), root], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    exited = once(child, 'exit')
    let didExit = false
    void exited.then(() => {
      didExit = true
    })
    const messages: unknown[] = []
    child.on('message', message => messages.push(message))
    await expect.poll(() => messages).toContain('ready')
    child.send!({ type: WORKER_PARENT_SHUTDOWN })
    await expect.poll(() => messages).toContain('draining')
    expect(didExit).toBe(false)
    expect(await readFile(resolveWorkerSingleInstanceLockPath(root), 'utf8')).toContain('pid')
    child.send!('complete-work')
    expect(
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Worker failed to drain and exit')), 5000)
        }),
      ]),
    ).toEqual([0, null])
    expect(await readFile(join(root, 'completed'), 'utf8')).toBe('durable result')
    await expect(readFile(resolveWorkerSingleInstanceLockPath(root))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  } finally {
    if (deadline) {
      clearTimeout(deadline)
    }
    if (child && child.exitCode === null) {
      child.kill('SIGKILL')
    }
    if (exited) {
      await exited
    }
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
