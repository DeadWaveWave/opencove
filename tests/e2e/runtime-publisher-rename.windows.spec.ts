import { expect, test } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function observe(child: ChildProcessWithoutNullStreams) {
  const output = { stdout: '', stderr: '' }
  child.stdout.on('data', chunk => (output.stdout += String(chunk)))
  child.stderr.on('data', chunk => (output.stderr += String(chunk)))
  child.on('error', error => (output.stderr += error.message))
  const closed = new Promise<number | null>(done => child.once('close', done))
  return { child, output, closed }
}

test('publishes from the staged Node after a Windows sharing lock is released', async () => {
  test.skip(process.platform !== 'win32', 'Windows directory sharing semantics')
  const root = await mkdtemp(join(tmpdir(), 'opencove-publisher-lock-'))
  const processes: ReturnType<typeof observe>[] = []
  try {
    const staging = join(root, 'staging')
    const destination = join(root, 'published')
    const node = join(staging, 'runtime/node/node.exe')
    const publisher = join(staging, 'publishRuntime.mjs')
    await mkdir(join(staging, 'runtime/node'), { recursive: true })
    await mkdir(join(staging, 'app/out/main'), { recursive: true })
    await copyFile(process.execPath, node)
    await copyFile(resolve('src/app/cli/publishRuntime.mjs'), publisher)
    const identity = {
      build: { buildId: 'a'.repeat(64) },
      platform: 'win32',
      arch: process.arch,
      engine: 'node',
    }
    await writeFile(
      join(staging, 'app/out/main/managedRuntime.js'),
      `process.stdout.write(${JSON.stringify(JSON.stringify(identity))})`,
    )
    const lockedFile = join(staging, 'payload')
    await writeFile(lockedFile, 'verified content')
    // Read sharing permits verification, but withholding delete sharing blocks rename.
    const lock = observe(
      spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `
      $ErrorActionPreference = 'Stop'
      $file = [IO.File]::Open($env:OPENCOVE_TEST_LOCK_FILE, 'Open', 'Read', 'Read')
      try {
        [Console]::Out.WriteLine('locked')
        [Console]::In.ReadLine() | Out-Null
      } finally { $file.Dispose() }
    `,
        ],
        {
          windowsHide: true,
          timeout: 15_000,
          env: { ...process.env, OPENCOVE_TEST_LOCK_FILE: lockedFile },
        },
      ),
    )
    processes.push(lock)
    await Promise.race([
      new Promise<void>(done =>
        lock.child.stdout.on('data', () => {
          if (lock.output.stdout.includes('locked')) {
            done()
          }
        }),
      ),
      lock.closed.then(() => {
        throw new Error(`Lock holder exited early: ${lock.output.stderr}`)
      }),
    ])

    const publication = observe(
      spawn(node, [publisher, staging, destination, 'a'.repeat(64)], {
        cwd: root,
        windowsHide: true,
        timeout: 15_000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      }),
    )
    processes.push(publication)
    let released = false
    publication.child.stderr.on('data', () => {
      // Release only after the real rename has failed. No timing-based lock lifetime.
      if (!released && publication.output.stderr.includes('Retrying runtime publication rename')) {
        released = true
        lock.child.stdin.end('\n')
      }
    })
    expect(await publication.closed, JSON.stringify(publication.output)).toBe(0)
    expect(released, JSON.stringify(publication.output)).toBe(true)
    expect(publication.output.stdout.trim()).toBe(destination)
    expect(await lock.closed, lock.output.stderr).toBe(0)
    expect(await readFile(join(destination, 'payload'), 'utf8')).toBe('verified content')
    expect(JSON.parse(await readFile(join(destination, 'artifact.json'), 'utf8')).digest).toBe(
      'a'.repeat(64),
    )
  } finally {
    for (const process of processes) {
      if (process.child.exitCode === null) {
        process.child.kill()
      }
    }
    await Promise.all(processes.map(process => process.closed))
    await rm(root, { recursive: true, force: true })
  }
})
