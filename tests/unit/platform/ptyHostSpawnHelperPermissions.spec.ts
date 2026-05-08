import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  ensureNodePtySpawnHelperExecutable,
  resolveNodePtySpawnHelperPaths,
} from '../../../src/platform/process/ptyHost/spawnHelperPermissions'

describe('ptyHost spawn-helper permissions', () => {
  const tempRoots: string[] = []

  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop()
      if (!root) {
        continue
      }

      rmSync(root, { recursive: true, force: true })
    }
  })

  it('repairs a non-executable spawn-helper on macOS arm64', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'opencove-spawn-helper-'))
    tempRoots.push(tempRoot)

    const packageRoot = join(tempRoot, 'node-pty')
    const unixTerminalPath = join(packageRoot, 'lib', 'unixTerminal.js')
    const helperPath = join(packageRoot, 'prebuilds', 'darwin-arm64', 'spawn-helper')

    mkdirSync(dirname(unixTerminalPath), { recursive: true })
    mkdirSync(dirname(helperPath), { recursive: true })
    writeFileSync(unixTerminalPath, '')
    writeFileSync(helperPath, '')
    chmodSync(helperPath, 0o644)

    expect(
      resolveNodePtySpawnHelperPaths({
        requireResolve: spec => {
          expect(spec).toBe('node-pty/lib/unixTerminal.js')
          return unixTerminalPath
        },
        platform: 'darwin',
        arch: 'arm64',
      }),
    ).toContain(helperPath)

    const repaired = ensureNodePtySpawnHelperExecutable({
      requireResolve: spec => {
        expect(spec).toBe('node-pty/lib/unixTerminal.js')
        return unixTerminalPath
      },
      statSync,
      chmodSync,
      platform: 'darwin',
      arch: 'arm64',
    })

    expect(repaired).toBe(true)
    expect(statSync(helperPath).mode & 0o111).not.toBe(0)
  })
})
