import { describe, expect, it, vi } from 'vitest'
import {
  killWindowsProcessTree,
  type WindowsProcessTreeKiller,
} from '../../../src/platform/process/ptyHost/windowsProcessTree'

function createKiller(status: number | null, error?: unknown): WindowsProcessTreeKiller {
  return {
    kill: vi.fn(() => ({ status, ...(error ? { error } : {}) })),
  }
}

describe('killWindowsProcessTree', () => {
  it('skips non-Windows platforms', () => {
    const killer = createKiller(0)

    expect(killWindowsProcessTree(123, { platform: 'darwin', killer })).toBe('skipped')
    expect(killer.kill).not.toHaveBeenCalled()
  })

  it('skips invalid pids', () => {
    const killer = createKiller(0)

    expect(killWindowsProcessTree(null, { platform: 'win32', killer })).toBe('skipped')
    expect(killWindowsProcessTree(0, { platform: 'win32', killer })).toBe('skipped')
    expect(killer.kill).not.toHaveBeenCalled()
  })

  it('terminates a Windows process tree through taskkill semantics', () => {
    const killer = createKiller(0)

    expect(killWindowsProcessTree(123.8, { platform: 'win32', killer })).toBe('terminated')
    expect(killer.kill).toHaveBeenCalledWith(123)
  })

  it('treats already-exited Windows processes as cleaned up', () => {
    const killer = createKiller(128)

    expect(killWindowsProcessTree(123, { platform: 'win32', killer })).toBe('not_found')
  })

  it('reports taskkill failures for fallback handling', () => {
    const killer = createKiller(5)

    expect(killWindowsProcessTree(123, { platform: 'win32', killer })).toBe('failed')
  })
})
