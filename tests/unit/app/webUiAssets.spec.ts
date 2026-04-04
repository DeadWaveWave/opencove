import { afterEach, describe, expect, it } from 'vitest'
import { tryResolveWebUiResponse } from '../../../src/app/main/controlSurface/webUiAssets'

describe('web UI assets', () => {
  const originalRendererUrl = process.env['ELECTRON_RENDERER_URL']

  afterEach(() => {
    if (originalRendererUrl === undefined) {
      delete process.env['ELECTRON_RENDERER_URL']
    } else {
      process.env['ELECTRON_RENDERER_URL'] = originalRendererUrl
    }
  })

  it('includes the react refresh preamble in dev web UI html', () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://127.0.0.1:5173/'

    const response = tryResolveWebUiResponse('/')
    expect(response).not.toBeNull()
    if (!response) {
      return
    }

    expect(response.statusCode).toBe(200)
    expect(response.contentType).toContain('text/html')
    expect(typeof response.body).toBe('string')

    const body = response.body as string
    expect(body).toContain('window.__vite_plugin_react_preamble_installed__ = true')
    expect(body).toContain("import RefreshRuntime from 'http://127.0.0.1:5173/@react-refresh'")
    expect(body).toContain('http://127.0.0.1:5173/@vite/client')
    expect(body).toContain('http://127.0.0.1:5173/web-main.tsx')
  })

  it('can disable the dev renderer origin for non-loopback requests', () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://127.0.0.1:5173/'

    const response = tryResolveWebUiResponse('/', { allowDevOrigin: false })
    expect(response).not.toBeNull()
    if (!response) {
      return
    }

    const bodyText =
      typeof response.body === 'string' ? response.body : response.body.toString('utf8')
    expect(bodyText).not.toContain('http://127.0.0.1:5173/@vite/client')
    expect(bodyText).not.toContain('http://127.0.0.1:5173/@react-refresh')
  })
})
