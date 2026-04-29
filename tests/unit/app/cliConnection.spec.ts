import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

const fsPromisesMock = vi.hoisted(() => ({
  readFile: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  default: fsPromisesMock,
}))

import {
  resolveConnectionInfo,
  resolveWorkerConnectionInfo,
} from '../../../src/app/cli/connection.mjs'

function createConnectionFileJson(overrides?: Partial<Record<string, unknown>>): string {
  return JSON.stringify({
    version: 1,
    pid: 4242,
    hostname: '127.0.0.1',
    port: 4312,
    token: 'token-123',
    createdAt: '2026-04-26T02:10:00.000Z',
    ...overrides,
  })
}

describe('CLI connection resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    fsPromisesMock.readFile.mockReset()
  })

  it('restricts lookup to OPENCOVE_USER_DATA_DIR when explicitly set', async () => {
    const explicitUserDataDir = '/tmp/opencove-explicit-user-data'
    vi.stubEnv('OPENCOVE_USER_DATA_DIR', explicitUserDataDir)
    vi.spyOn(process, 'kill').mockImplementation((() => undefined) as typeof process.kill)

    fsPromisesMock.readFile.mockImplementation(async filePath => {
      expect(filePath).toBe(resolve(explicitUserDataDir, 'control-surface.json'))
      return createConnectionFileJson()
    })

    await expect(resolveConnectionInfo()).resolves.toMatchObject({
      hostname: '127.0.0.1',
      port: 4312,
      token: 'token-123',
      pid: 4242,
      createdAtMs: Date.parse('2026-04-26T02:10:00.000Z'),
    })
    expect(fsPromisesMock.readFile).toHaveBeenCalledTimes(2)
  })

  it('returns null when no control surface connection file exists in the explicit userData dir', async () => {
    const explicitUserDataDir = '/tmp/opencove-explicit-user-data'
    vi.stubEnv('OPENCOVE_USER_DATA_DIR', explicitUserDataDir)
    vi.spyOn(process, 'kill').mockImplementation((() => undefined) as typeof process.kill)

    fsPromisesMock.readFile.mockImplementation(async () => {
      throw new Error('ENOENT')
    })

    await expect(resolveConnectionInfo()).resolves.toBeNull()
    expect(fsPromisesMock.readFile).toHaveBeenCalledTimes(2)
  })

  it('reads worker status from worker-control-surface.json', async () => {
    const explicitUserDataDir = '/tmp/opencove-explicit-user-data'
    vi.stubEnv('OPENCOVE_USER_DATA_DIR', explicitUserDataDir)
    vi.spyOn(process, 'kill').mockImplementation((() => undefined) as typeof process.kill)

    fsPromisesMock.readFile.mockImplementation(async filePath => {
      expect(filePath).toBe(resolve(explicitUserDataDir, 'worker-control-surface.json'))
      return createConnectionFileJson({
        pid: 5252,
        port: 54262,
        createdAt: '2026-04-26T02:12:00.000Z',
      })
    })

    await expect(resolveWorkerConnectionInfo()).resolves.toMatchObject({
      hostname: '127.0.0.1',
      port: 54262,
      token: 'token-123',
      pid: 5252,
      createdAtMs: Date.parse('2026-04-26T02:12:00.000Z'),
    })
    expect(fsPromisesMock.readFile).toHaveBeenCalledTimes(1)
  })

  it('falls back to worker-control-surface.json for general CLI commands', async () => {
    const explicitUserDataDir = '/tmp/opencove-explicit-user-data'
    vi.stubEnv('OPENCOVE_USER_DATA_DIR', explicitUserDataDir)
    vi.spyOn(process, 'kill').mockImplementation((() => undefined) as typeof process.kill)

    fsPromisesMock.readFile.mockImplementation(async filePath => {
      if (filePath === resolve(explicitUserDataDir, 'control-surface.json')) {
        throw new Error('ENOENT')
      }

      expect(filePath).toBe(resolve(explicitUserDataDir, 'worker-control-surface.json'))
      return createConnectionFileJson({
        pid: 5353,
        port: 55262,
        createdAt: '2026-04-26T02:13:00.000Z',
      })
    })

    await expect(resolveConnectionInfo()).resolves.toMatchObject({
      hostname: '127.0.0.1',
      port: 55262,
      token: 'token-123',
      pid: 5353,
      createdAtMs: Date.parse('2026-04-26T02:13:00.000Z'),
    })
    expect(fsPromisesMock.readFile).toHaveBeenCalledTimes(2)
  })
})
