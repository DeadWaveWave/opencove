import { describe, expect, it } from 'vitest'
import { shouldAllowDevWebUiOrigin } from '../../../src/app/main/controlSurface/http/devWebUiOrigin'

describe('dev web ui origin policy', () => {
  it('allows loopback hosts', () => {
    expect(shouldAllowDevWebUiOrigin('127.0.0.1:1234')).toBe(true)
    expect(shouldAllowDevWebUiOrigin('localhost:1234')).toBe(true)
    expect(shouldAllowDevWebUiOrigin('[::1]:1234')).toBe(true)
  })

  it('rejects LAN hosts', () => {
    expect(shouldAllowDevWebUiOrigin('192.168.1.20:1234')).toBe(false)
    expect(shouldAllowDevWebUiOrigin('10.0.0.5:1234')).toBe(false)
  })
})
