import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')

describe('standalone Node distribution contracts', () => {
  it('builds and verifies native modules for the bundled Node ABI', async () => {
    const builder = await readFile(
      resolve(rootDir, 'scripts/create-standalone-server-bundle.mjs'),
      'utf8',
    )

    expect(builder).toContain("electronBuilderRequire.resolve('node-gyp/bin/node-gyp.js')")
    expect(builder).toContain("'better-sqlite3', 'node-pty'")
    expect(builder).toContain('native modules loaded with Node ABI')
    expect(builder).toContain('OPENCOVE_NODE_MODULE_VERSION=')
  })

  it('writes launchers that invoke Node without Electron compatibility mode', async () => {
    const [shellInstaller, powershellInstaller] = await Promise.all([
      readFile(resolve(rootDir, 'scripts/release-assets/opencove-install.sh'), 'utf8'),
      readFile(resolve(rootDir, 'scripts/release-assets/opencove-install.ps1'), 'utf8'),
    ])

    for (const installer of [shellInstaller, powershellInstaller]) {
      expect(installer).toContain('OPENCOVE_NODE_BIN')
      expect(installer).not.toContain('ELECTRON_RUN_AS_NODE')
    }
  })

  it('runs the Linux release smoke in a minimal container', async () => {
    const [workflow, smoke] = await Promise.all([
      readFile(resolve(rootDir, '.github/workflows/release.yml'), 'utf8'),
      readFile(resolve(rootDir, 'scripts/smoke-standalone-node-runtime.sh'), 'utf8'),
    ])

    expect(workflow).toContain('debian:bookworm-slim')
    expect(workflow).toContain('smoke-standalone-node-runtime.sh')
    expect(smoke).toContain('/proc/${LAUNCHER_PID}/exe')
    expect(smoke).toContain('/proc/${WORKER_PID}/exe')
    expect(smoke).toContain('no Electron executable present')
  })
})
