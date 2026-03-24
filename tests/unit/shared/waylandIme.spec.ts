import { describe, expect, it } from 'vitest'
import { shouldEnableWaylandIme } from '../../../src/app/main/waylandIme'

describe('shouldEnableWaylandIme', () => {
  it('enables Wayland IME on Linux Wayland sessions', () => {
    expect(
      shouldEnableWaylandIme({
        platform: 'linux',
        env: {
          XDG_SESSION_TYPE: 'wayland',
        },
        argv: [],
      }),
    ).toBe(true)
  })

  it('enables Wayland IME when the ozone platform is explicitly set to wayland', () => {
    expect(
      shouldEnableWaylandIme({
        platform: 'linux',
        env: {},
        argv: ['--ozone-platform=wayland'],
      }),
    ).toBe(true)
  })

  it('disables Wayland IME when Linux is explicitly forced onto x11', () => {
    expect(
      shouldEnableWaylandIme({
        platform: 'linux',
        env: {
          XDG_SESSION_TYPE: 'wayland',
          WAYLAND_DISPLAY: 'wayland-0',
        },
        argv: ['--ozone-platform=x11'],
      }),
    ).toBe(false)
  })

  it('supports NixOS native Wayland hints', () => {
    expect(
      shouldEnableWaylandIme({
        platform: 'linux',
        env: {
          NIXOS_OZONE_WL: '1',
        },
        argv: [],
      }),
    ).toBe(true)
  })

  it('keeps non-Linux platforms unchanged', () => {
    expect(
      shouldEnableWaylandIme({
        platform: 'darwin',
        env: {
          XDG_SESSION_TYPE: 'wayland',
          WAYLAND_DISPLAY: 'wayland-0',
        },
        argv: [],
      }),
    ).toBe(false)
  })
})
