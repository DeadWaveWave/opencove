// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalResolvedFileTarget } from '../../../src/contexts/terminal/domain/links/terminalLinkTarget'
import {
  canOpenTerminalTargetWithSystem,
  getTerminalSystemOpenCapability,
  openTerminalTargetWithSystem,
} from '../../../src/contexts/workspace/presentation/renderer/utils/terminalLinkApi'

function installApi(runtime: 'electron' | 'browser' = 'electron', mode: unknown = 'local') {
  const openPath = vi.fn(async () => undefined)
  const getConfig = vi.fn(async () => ({ mode }))
  vi.stubGlobal('window', {
    opencoveApi: { meta: { runtime }, workspace: { openPath }, workerClient: { getConfig } },
  })
  return { openPath, getConfig }
}

function target(overrides: Partial<TerminalResolvedFileTarget> = {}): TerminalResolvedFileTarget {
  return {
    kind: 'directory',
    uri: 'file:///Users/example/project%20with%20spaces',
    path: '/Users/example/project with spaces',
    endpointId: 'local',
    mountId: 'local-mount',
    ...overrides,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('terminal link system opener', () => {
  it.each(['file', 'directory'] as const)(
    'opens a verified local %s using its decoded path and the existing system opener',
    async kind => {
      const { openPath } = installApi()
      const value = target({ kind })
      const capability = await getTerminalSystemOpenCapability()
      expect(canOpenTerminalTargetWithSystem(value, capability)).toBe(true)
      await expect(openTerminalTargetWithSystem(value, capability)).resolves.toBe(true)
      expect(openPath).toHaveBeenCalledExactlyOnceWith({
        path: value.path,
        openerId: 'finder',
      })
    },
  )

  it('preserves the existing unbound local default without inferring a mount owner', async () => {
    const { openPath } = installApi()
    const value = target({ endpointId: undefined, mountId: undefined })
    expect(canOpenTerminalTargetWithSystem(value, true)).toBe(true)
    await expect(openTerminalTargetWithSystem(value, true)).resolves.toBe(true)
    expect(openPath).toHaveBeenCalledOnce()
  })

  it.each([
    { endpointId: 'remote', mountId: 'remote-mount' },
    { endpointId: 'remote', mountId: undefined },
    { endpointId: undefined, mountId: 'unknown-owner-mount' },
    { endpointId: '', mountId: undefined },
  ])('never opens a remote or unknown owner locally: %j', async identity => {
    const { openPath } = installApi()
    const value = target(identity)
    expect(canOpenTerminalTargetWithSystem(value, true)).toBe(false)
    await expect(openTerminalTargetWithSystem(value, true)).resolves.toBe(false)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('does not mistake the Web no-op method for system-open support', async () => {
    const { openPath, getConfig } = installApi('browser')
    await expect(getTerminalSystemOpenCapability()).resolves.toBe(false)
    expect(canOpenTerminalTargetWithSystem(target(), true)).toBe(false)
    await expect(openTerminalTargetWithSystem(target(), true)).resolves.toBe(false)
    expect(getConfig).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
  })

  it('preserves IPC failures for the caller without authorizing or retrying the path', async () => {
    const { openPath } = installApi()
    const error = Object.assign(new Error('Path is not approved'), {
      code: 'common.approved_path_required',
    })
    openPath.mockRejectedValue(error)
    await expect(openTerminalTargetWithSystem(target(), true)).rejects.toBe(error)
    expect(openPath).toHaveBeenCalledOnce()
  })

  it.each(['standalone', 'local'])('allows only a known desktop %s HomeWorker', async mode => {
    const { getConfig } = installApi('electron', mode)
    await expect(getTerminalSystemOpenCapability()).resolves.toBe(true)
    expect(getConfig).toHaveBeenCalledOnce()
  })

  it.each(['remote', null, 'unknown', {}])(
    'does not treat local endpoint paths on a %j HomeWorker as desktop paths',
    async mode => {
      const { openPath } = installApi('electron', mode)
      const capability = await getTerminalSystemOpenCapability()
      expect(capability).toBe(false)
      expect(canOpenTerminalTargetWithSystem(target(), capability)).toBe(false)
      await expect(openTerminalTargetWithSystem(target(), capability)).resolves.toBe(false)
      expect(openPath).not.toHaveBeenCalled()
    },
  )

  it('keeps unresolved capability closed instead of defaulting a local endpoint to this machine', async () => {
    const { openPath } = installApi()
    expect(canOpenTerminalTargetWithSystem(target())).toBe(false)
    await expect(openTerminalTargetWithSystem(target())).resolves.toBe(false)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('treats a failed HomeWorker configuration query as unavailable', async () => {
    const { getConfig, openPath } = installApi()
    getConfig.mockRejectedValue(new Error('Configuration unavailable'))
    const capability = await getTerminalSystemOpenCapability()
    expect(capability).toBe(false)
    await expect(openTerminalTargetWithSystem(target(), capability)).resolves.toBe(false)
    expect(openPath).not.toHaveBeenCalled()
  })
})
