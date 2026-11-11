import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { OpenCoveApi } from '../../../src/app/preload/api'
import { createRendererBridge } from '../../../src/app/preload/rendererBridge'
import {
  createDesktopOpenCoveApi,
  installDesktopOpenCoveApi,
} from '../../../src/app/renderer/bootstrap/installDesktopOpenCoveApi'
import { OpenCoveAppError, createAppError } from '../../../src/shared/errors/appError'
import { persistenceWriteFailure } from '../../../src/shared/sync/persistenceWriteOutcome'
import { startDesktop } from '../../../src/app/renderer/bootstrap/startDesktop'

function roundTrip(api: unknown) {
  return createDesktopOpenCoveApi(createRendererBridge(api as OpenCoveApi))
}
afterEach(() => vi.restoreAllMocks())

describe('renderer bridge contract', () => {
  it('preserves sync returns, receiver, argument count, File and bytes without traversing values', async () => {
    const file = new File(['x'], 'x.txt')
    const bytes = new Uint8Array([0, 255])
    const value = {
      ok: false,
      bytes,
      get privateField() {
        throw Error('must not traverse')
      },
    }
    const getPathForFile = vi.fn(function (this: { prefix: string }, ...args: unknown[]) {
      expect(args).toEqual([file])
      expect(args[0]).toBe(file)
      return this.prefix
    })
    const invoke = vi.fn(async (...args: unknown[]) => {
      expect(args[0]).toBe(bytes)
      return value
    })
    const setBounds = vi.fn(() => undefined)
    const meta = { runtime: 'electron' }
    const api = roundTrip({
      meta,
      filesystem: { prefix: '/x', getPathForFile },
      websiteWindow: { setBounds },
      controlSurface: { invoke },
    })
    expect(api.filesystem.getPathForFile(file)).toBe('/x')
    expect(api.websiteWindow.setBounds({} as never)).toBeUndefined()
    expect(api.meta).toBe(meta)
    expect(typeof api.filesystem.resolveDroppedFile).toBe('undefined')
    const { invoke: call } = api.controlSurface
    expectTypeOf(call<{ answer: number }>).returns.toEqualTypeOf<Promise<{ answer: number }>>()
    expect(await call(bytes as never)).toBe(value)
    expect(getPathForFile).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it.each([false, true])(
    'revives sync/async application errors locally (async=%s)',
    async asynchronous => {
      const fail = () => {
        throw createAppError('filesystem.stat_failed', {
          params: { reason: 'permission_denied', secret: 'SECRET' },
          debugMessage: 'SECRET',
        })
      }
      const api = roundTrip({
        filesystem: { getPathForFile: asynchronous ? async () => fail() : fail },
      })
      try {
        await api.filesystem.getPathForFile(new File([], 'x'))
        throw Error('expected failure')
      } catch (error) {
        expect(error).toBeInstanceOf(OpenCoveAppError)
        expect((error as OpenCoveAppError).params).toEqual({ reason: 'permission_denied' })
        expect(JSON.stringify(error)).not.toContain('SECRET')
      }
    },
  )
  it('keeps an executed write with a corrupt response unknown and invokes it once', async () => {
    const write = vi.fn(async () => ({ invalid: true }))
    const api = createDesktopOpenCoveApi({ persistence: { writeAppState: write } } as never)
    const error = await api.persistence.writeAppState({} as never).catch(caught => caught)
    expect(error).toBeInstanceOf(Error)
    expect(persistenceWriteFailure(error).outcome).toBe('unknown')
    expect(write).toHaveBeenCalledTimes(1)
  })
  it('returns null, void, bytes and failure DTOs inside exactly one envelope', async () => {
    for (const value of [
      null,
      undefined,
      new Uint8Array([8]),
      { ok: false, reason: 'io', error: { code: 'persistence.io_failed' } },
      { __opencoveRendererBridge: 1, ok: true, value: 42 },
    ]) {
      const api = roundTrip({ controlSurface: { invoke: async () => value } })
      // oxlint-disable-next-line no-await-in-loop -- each payload identity is verified before the next fixture
      expect(await api.controlSurface.invoke({} as never)).toBe(value)
    }
  })
  it('installs once per document and reconstructs for a separate document', () => {
    const bridge = createRendererBridge({ controlSurface: { invoke: async () => null } } as never)
    const first = Object.assign(new EventTarget(), { __opencoveBridge: bridge }) as Window
    const second = Object.assign(new EventTarget(), { __opencoveBridge: bridge }) as Window
    installDesktopOpenCoveApi(first)
    const api = first.opencoveApi
    installDesktopOpenCoveApi(first)
    installDesktopOpenCoveApi(second)
    expect(first.opencoveApi).toBe(api)
    expect(second.opencoveApi).not.toBe(api)
  })
  it('installs before application module evaluation and handles startup failures', async () => {
    window.opencoveApi = { meta: { isTest: false } } as OpenCoveApi
    const order: string[] = []
    await startDesktop(
      () => {
        order.push('install')
      },
      async () => {
        order.push('evaluate')
        return {
          renderApp: () => {
            order.push('render')
          },
        }
      },
    )
    expect(order).toEqual(['install', 'evaluate', 'render'])
    document.body.innerHTML = '<div id="root"></div>'
    await startDesktop(() => {
      throw Error('SECRET')
    })
    expect(document.getElementById('root')?.textContent).toContain('OpenCove could not start.')
    expect(document.body.textContent).not.toContain('SECRET')
    await startDesktop(
      () => {},
      async () => {
        throw Error('SECRET')
      },
    )
    expect(document.querySelector('button')?.textContent).toBe('Reload window')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN')
    await startDesktop(() => {
      throw Error('SECRET')
    })
    expect(document.getElementById('root')?.textContent).toContain('OpenCove 无法启动。')
    expect(document.querySelector('button')?.textContent).toBe('重新加载')
  })
})
