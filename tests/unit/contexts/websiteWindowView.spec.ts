import { describe, expect, it, vi } from 'vitest'
import {
  configureWebsiteSessionPermissions,
  configureWebsiteViewAppearance,
} from '../../../src/app/main/websiteWindow/websiteWindowView'

describe('websiteWindowView', () => {
  it('configures the native website view with rounded corners', () => {
    const setBackgroundColor = vi.fn()
    const setBorderRadius = vi.fn()

    configureWebsiteViewAppearance({
      setBackgroundColor,
      setBorderRadius,
    } as unknown as Parameters<typeof configureWebsiteViewAppearance>[0])

    expect(setBackgroundColor).toHaveBeenCalledWith('#00000000')
    expect(setBorderRadius).toHaveBeenCalledWith(13)
  })

  it('routes session permission and download hooks through manager callbacks once per session', () => {
    const setPermissionCheckHandler = vi.fn()
    const setPermissionRequestHandler = vi.fn()
    const on = vi.fn()
    const session = { setPermissionCheckHandler, setPermissionRequestHandler, on }
    const contents = { getURL: () => 'https://example.test/page' }
    const onPermissionCheck = vi.fn(() => true)
    const onPermissionRequest = vi.fn()
    const onDownload = vi.fn()
    const configuredSessions = new WeakSet()

    configureWebsiteSessionPermissions({
      configuredSessions,
      session: session as Parameters<typeof configureWebsiteSessionPermissions>[0]['session'],
      onPermissionCheck,
      onPermissionRequest,
      onDownload,
    })
    configureWebsiteSessionPermissions({
      configuredSessions,
      session: session as Parameters<typeof configureWebsiteSessionPermissions>[0]['session'],
    })

    expect(setPermissionCheckHandler).toHaveBeenCalledTimes(1)
    expect(setPermissionRequestHandler).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledTimes(1)
    expect(
      setPermissionCheckHandler.mock.calls[0][0](contents, 'media', 'https://example.test'),
    ).toBe(true)

    const permissionCallback = vi.fn()
    setPermissionRequestHandler.mock.calls[0][0](contents, 'media', permissionCallback, {})
    expect(onPermissionRequest).toHaveBeenCalledWith(
      contents,
      'media',
      'https://example.test/page',
      permissionCallback,
    )

    const item = { getURL: () => 'https://example.test/file.zip' }
    on.mock.calls[0][1](null, item, contents)
    expect(onDownload).toHaveBeenCalledWith(contents, item)
  })
})
