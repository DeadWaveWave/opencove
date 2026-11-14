#!/usr/bin/env node
import './lib/isolateHostEnvironment.mjs'
// Run against separately built before/after worktrees; uses only public API available in both.
import { _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const appPath = resolve(process.argv[2] ?? '.')
const label = process.argv[3] ?? 'after'
const root = await mkdtemp(join(tmpdir(), 'opencove-bridge-measure-'))
const workspace = join(root, 'workspace')
await mkdir(workspace)
await Promise.all(
  ['home', 'config', 'cache', 'runtime'].map(directory => mkdir(join(root, directory))),
)
const file = join(workspace, 'bytes.bin')
await writeFile(file, new Uint8Array(4 * 1024 * 1024).fill(97))
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined),
)
delete env.ELECTRON_RUN_AS_NODE
delete env.__CFBundleIdentifier
let app
try {
  app = await electron.launch({
    args: [appPath],
    env: {
      ...env,
      NODE_ENV: 'test',
      OPENCOVE_TEST_USER_DATA_DIR: join(root, 'profile'),
      HOME: join(root, 'home'),
      USERPROFILE: join(root, 'home'),
      XDG_CONFIG_HOME: join(root, 'config'),
      XDG_CACHE_HOME: join(root, 'cache'),
      XDG_RUNTIME_DIR: join(root, 'runtime'),
      OPENCOVE_TEST_WORKSPACE: workspace,
      OPENCOVE_WORKER_CLIENT: '0',
      OPENCOVE_E2E_WINDOW_MODE: 'offscreen',
      OPENCOVE_TEST_DISABLE_WORKTREE_WATCHER: '1',
    },
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => typeof window.opencoveApi?.pty?.spawn === 'function')
  const measurements = await page.evaluate(
    async ({ workspace: workingDirectory, uri }) => {
      const api = window.opencoveApi
      const { sessionId } = await api.pty.spawn({ cwd: workingDirectory, cols: 120, rows: 40 })
      // Data events are delivered only to attached sessions, as in the canvas.
      await api.pty.attach({ sessionId })
      try {
        // One burst: 200 sequential input writes with an empty line reset at the end.
        let start = performance.now()
        for (let i = 0; i < 200; i += 1) {
          await api.pty.write({ sessionId, data: 'x' })
        }
        const inputBurstMs = performance.now() - start
        await api.pty.write({ sessionId, data: '\x15' })
        let bytes = 0
        let output = ''
        let finish
        const completed = new Promise(resolveStream => {
          finish = resolveStream
        })
        const stop = api.pty.onData(event => {
          if (event.sessionId !== sessionId) {
            return
          }
          bytes += event.data.length
          // Search before trimming: a batched event can carry the marker followed by a long prompt.
          const window = output + event.data
          output = window.slice(-200)
          if (window.includes('OC_STREAM_FINISHED')) {
            finish()
          }
        })
        let timer
        try {
          start = performance.now()
          // Split the marker in source so the terminal echo cannot complete the measurement.
          // A shell-only generator: the isolated test HOME may not have node on PATH.
          const line = 'x'.repeat(128)
          const command =
            api.meta.platform === 'win32'
              ? `1..2048 | % { '${line}' }; 'OC_STREAM_' + 'FINISHED'\r`
              : `i=0; while [ $i -lt 2048 ]; do echo ${line}; i=$((i+1)); done; echo OC_STREAM_''FINISHED\r`
          await api.pty.write({ sessionId, data: command })
          await Promise.race([
            completed,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('Output measurement timed out')), 30000)
            }),
          ])
          const outputStreamMs = performance.now() - start
          start = performance.now()
          const result = await api.filesystem.readFileBytes({ uri })
          return {
            inputBurstMs,
            outputStreamMs,
            outputCharacters: bytes,
            largePayloadMs: performance.now() - start,
            payloadBytes: result.bytes.byteLength,
          }
        } finally {
          clearTimeout(timer)
          stop()
        }
      } finally {
        await api.pty.kill({ sessionId })
      }
    },
    { workspace, uri: pathToFileURL(file).href },
  )
  process.stdout.write(JSON.stringify({ label, appPath, ...measurements }, null, 2) + '\n')
} finally {
  await app?.close()
  await rm(root, { recursive: true, force: true })
}
