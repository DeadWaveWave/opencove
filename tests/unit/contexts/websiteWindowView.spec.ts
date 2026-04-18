import { describe, expect, it, vi } from 'vitest'
import { configureWebsiteViewAppearance } from '../../../src/app/main/websiteWindow/websiteWindowView'

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
})
