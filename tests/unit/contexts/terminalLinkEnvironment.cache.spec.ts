import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadApi() {
  vi.resetModules()
  return await import('../../../src/contexts/workspace/presentation/renderer/utils/terminalLinkApi')
}

function stubInvoke(invoke: (request: unknown) => Promise<unknown>): void {
  vi.stubGlobal('window', {
    ...globalThis.window,
    opencoveApi: { controlSurface: { invoke: vi.fn(invoke) } },
  })
}

describe('terminal link environment', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks an endpoint for its home directory once', async () => {
    stubInvoke(async () => ({ platform: 'linux', homeDirectory: '/home/u', hostname: 'h' }))
    const { getTerminalLinkEnvironment } = await loadApi()

    const results = await Promise.all([
      getTerminalLinkEnvironment('local'),
      getTerminalLinkEnvironment('local'),
    ])
    await getTerminalLinkEnvironment('local')

    expect(results[0]).toEqual({ platform: 'posix', home: '/home/u', hostname: 'h' })
    expect(window.opencoveApi.controlSurface.invoke).toHaveBeenCalledTimes(1)
  })

  it('retries after a failed lookup', async () => {
    let calls = 0
    stubInvoke(async () => {
      calls += 1
      if (calls === 1) {
        throw new Error('worker unavailable')
      }
      return { platform: 'win32', homeDirectory: 'C:\\Users\\u' }
    })
    const { getTerminalLinkEnvironment } = await loadApi()

    await expect(getTerminalLinkEnvironment('remote-1')).resolves.toBeNull()
    await expect(getTerminalLinkEnvironment('remote-1')).resolves.toEqual({
      platform: 'windows',
      home: 'C:\\Users\\u',
      hostname: undefined,
    })
    expect(calls).toBe(2)
  })
})
