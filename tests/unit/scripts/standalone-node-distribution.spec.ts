import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  STANDALONE_NATIVE_MODULE_NAMES,
  resolveNativeModuleRebuildTargets,
  resolveOptionalNativeExecutables,
} from '../../../scripts/lib/standalone-native-modules.mjs'

const rootDir = resolve(import.meta.dirname, '../../..')

describe('standalone Node distribution contracts', () => {
  it('builds and verifies native modules for the bundled Node ABI', async () => {
    const builder = await readFile(
      resolve(rootDir, 'scripts/create-standalone-server-bundle.mjs'),
      'utf8',
    )

    expect(builder).toContain("electronBuilderRequire.resolve('node-gyp/bin/node-gyp.js')")
    expect(builder).toContain('native modules loaded with Node ABI')
    expect(builder).toContain('OPENCOVE_NODE_MODULE_VERSION=')
    expect(STANDALONE_NATIVE_MODULE_NAMES).toEqual(['better-sqlite3', 'node-pty'])
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
    expect(smoke).toContain('connection.appVersion !== packageJson.version')
    expect(smoke).toContain('no Electron executable present')
  })

  it('downloads and starts every published standalone Worker after the release is public', async () => {
    const workflow = await readFile(resolve(rootDir, '.github/workflows/release.yml'), 'utf8')
    const publishAt = workflow.indexOf('  publish:')
    const verificationAt = workflow.indexOf('  verify-published-standalone:')

    expect(publishAt).toBeGreaterThanOrEqual(0)
    expect(verificationAt).toBeGreaterThan(publishAt)
    const verification = workflow.slice(verificationAt)
    expect(verification).toContain('needs: publish')
    expect(verification).toContain('scripts/smoke-published-standalone-runtime.mjs')
    expect(verification).toContain('macos-15')
    expect(verification).toContain('macos-15-intel')
    expect(verification).toContain('windows-latest')
    expect(verification).toContain('ubuntu-latest')
  })
})

describe('native module rebuild targets', () => {
  // Regression guard for the Windows release failure: node-pty's binding.gyp shells out to
  // `node -p "require('node-addon-api')..."`, which resolves against process.cwd(). pnpm
  // installs behind symlinks/junctions. POSIX canonicalizes cwd on chdir, so the package's
  // own dependencies stay reachable; Windows keeps the junction path and they do not.
  it('hands node-gyp the realpath of each module, not the pnpm link path', () => {
    const linkPath = join('/repo', 'node_modules', 'node-pty')
    const realPath = join(
      '/repo',
      'node_modules',
      '.pnpm',
      'node-pty@1.1.0',
      'node_modules',
      'node-pty',
    )

    const targets = resolveNativeModuleRebuildTargets({
      rootDir: '/repo',
      appRoot: join('/bundle', 'app'),
      moduleNames: ['node-pty'],
      realpathSync: path => (path === linkPath ? realPath : path),
    })

    expect(targets).toHaveLength(1)
    expect(targets[0]?.cwd).toBe(realPath)
    expect(targets[0]?.cwd).not.toBe(linkPath)
    expect(targets[0]?.sourceRelease).toBe(join(realPath, 'build', 'Release'))
    // The destination stays addressed by module name inside the copied bundle.
    expect(targets[0]?.destinationRelease).toBe(
      join('/bundle', 'app', 'node_modules', 'node-pty', 'build', 'Release'),
    )
  })

  it('keeps node-pty dependencies resolvable from the realpath in this repo', () => {
    const realPath = resolveNativeModuleRebuildTargets({
      rootDir,
      appRoot: join(rootDir, 'dist', 'app'),
      moduleNames: ['node-pty'],
    })[0]?.cwd

    expect(realPath).toBeTruthy()
    const requireFromRealPath = createRequire(join(String(realPath), 'package.json'))
    expect(() => requireFromRealPath.resolve('node-addon-api')).not.toThrow()
  })
})

describe('optional native executables', () => {
  // Regression guard for the Linux release failure: node-pty only builds spawn-helper on
  // macOS (binding.gyp gates that target behind OS=="mac"), so chmod must never assume it.
  it('skips executables the platform does not build', () => {
    const executables = resolveOptionalNativeExecutables({
      appRoot: join('/bundle', 'app'),
      platform: 'linux',
      existsSync: () => false,
    })

    expect(executables).toEqual([])
  })

  it('marks spawn-helper executable when the platform built it', () => {
    const expected = join(
      '/bundle',
      'app',
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'spawn-helper',
    )
    const executables = resolveOptionalNativeExecutables({
      appRoot: join('/bundle', 'app'),
      platform: 'darwin',
      existsSync: path => path === expected,
    })

    expect(executables).toEqual([expected])
  })

  it('never chmods on Windows', () => {
    const executables = resolveOptionalNativeExecutables({
      appRoot: join('/bundle', 'app'),
      platform: 'win32',
      existsSync: () => true,
    })

    expect(executables).toEqual([])
  })
})

describe('bundle builder wiring', () => {
  it('uses the shared native-module helpers instead of inlining path assumptions', async () => {
    const builder = await readFile(
      resolve(rootDir, 'scripts/create-standalone-server-bundle.mjs'),
      'utf8',
    )

    expect(builder).toContain('resolveNativeModuleRebuildTargets')
    expect(builder).toContain('resolveOptionalNativeExecutables')
    // The unconditional spawn-helper chmod is what broke the Linux release.
    expect(builder).not.toMatch(/chmod\(\s*\n?\s*resolve\(appRoot, 'node_modules', 'node-pty'/u)
  })

  it('verifies native modules with the Node that ships in the bundle', async () => {
    const builder = await readFile(
      resolve(rootDir, 'scripts/create-standalone-server-bundle.mjs'),
      'utf8',
    )

    // Verifying with the build host's Node lets an unusable bundled runtime pass the build.
    expect(builder).toContain('bundledNodeExecutable')
    expect(builder).toMatch(/runChecked\(bundledNodeExecutable, \['-e', verifyScript\]/u)
    expect(builder).toContain('bundled runtime is Electron, not pure Node')
  })
})
