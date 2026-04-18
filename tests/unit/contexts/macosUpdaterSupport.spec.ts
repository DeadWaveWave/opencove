import { describe, expect, it, vi } from 'vitest'
import {
  extractDesignatedRequirement,
  isAdhocDesignatedRequirement,
  resolveMacUpdaterSupport,
} from '../../../src/contexts/update/infrastructure/main/macosUpdaterSupport'

describe('macosUpdaterSupport', () => {
  it('extracts the designated requirement from codesign output', () => {
    const requirement = extractDesignatedRequirement(
      [
        'Executable=/Applications/OpenCove.app/Contents/MacOS/OpenCove',
        '# designated => cdhash H"deadbeef"',
      ].join('\n'),
    )

    expect(requirement).toBe('cdhash H"deadbeef"')
  })

  it('detects ad-hoc designated requirements', () => {
    expect(isAdhocDesignatedRequirement('cdhash H"deadbeef"')).toBe(true)
    expect(
      isAdhocDesignatedRequirement('identifier "dev.deadwave.opencove" and anchor apple'),
    ).toBe(false)
  })

  it('treats non-darwin platforms as supported', () => {
    const result = resolveMacUpdaterSupport({
      platform: 'linux',
      appPath: '/Applications/OpenCove.app',
    })

    expect(result.supported).toBe(true)
    expect(result.message).toBeNull()
  })

  it('rejects ad-hoc signed apps because they pin a cdhash requirement', () => {
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: '',
      stderr: '# designated => cdhash H"deadbeef"\n',
    })) as unknown as Parameters<typeof resolveMacUpdaterSupport>[0]['spawn']

    const result = resolveMacUpdaterSupport({
      platform: 'darwin',
      appPath: '/Applications/OpenCove.app',
      spawn,
    })

    expect(result.supported).toBe(false)
    expect(result.designatedRequirement).toContain('cdhash')
    expect(result.message).toContain('ad-hoc')
  })

  it('accepts stable designated requirements', () => {
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: '',
      stderr: 'designated => identifier "dev.deadwave.opencove" and anchor apple\n',
    })) as unknown as Parameters<typeof resolveMacUpdaterSupport>[0]['spawn']

    const result = resolveMacUpdaterSupport({
      platform: 'darwin',
      appPath: '/Applications/OpenCove.app',
      spawn,
    })

    expect(result.supported).toBe(true)
    expect(result.message).toBeNull()
    expect(result.designatedRequirement).toContain('identifier')
  })

  it('marks codesign failures as unsupported', () => {
    const spawn = vi.fn(() => ({
      status: 1,
      stdout: '',
      stderr: 'codesign error: some failure\n',
    })) as unknown as Parameters<typeof resolveMacUpdaterSupport>[0]['spawn']

    const result = resolveMacUpdaterSupport({
      platform: 'darwin',
      appPath: '/Applications/OpenCove.app',
      spawn,
    })

    expect(result.supported).toBe(false)
    expect(result.message).toContain('signed build')
  })
})
