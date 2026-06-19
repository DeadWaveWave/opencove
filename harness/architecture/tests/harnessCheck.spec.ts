import { describe, expect, it } from 'vitest'
import { resolveSpawnInvocation } from '../../lib/spawn-command.mjs'

describe('harness check command spawning', () => {
  it('runs node directly on Windows when the executable path contains spaces', () => {
    expect(
      resolveSpawnInvocation('node', {
        platform: 'win32',
        execPath: 'C:\\Program Files\\nodejs\\node.exe',
      }),
    ).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      shell: false,
    })
  })

  it('runs Windows command shims through the shell', () => {
    expect(
      resolveSpawnInvocation('pnpm', {
        platform: 'win32',
        execPath: 'C:\\Program Files\\nodejs\\node.exe',
      }),
    ).toEqual({
      command: 'pnpm.cmd',
      shell: true,
    })
  })

  it('does not use the shell for posix package manager commands', () => {
    expect(
      resolveSpawnInvocation('pnpm', {
        platform: 'darwin',
        execPath: '/opt/homebrew/bin/node',
      }),
    ).toEqual({
      command: 'pnpm',
      shell: false,
    })
  })
})
