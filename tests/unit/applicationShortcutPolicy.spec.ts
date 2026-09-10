import { describe, expect, it } from 'vitest'
import { createApplicationShortcutPolicy } from '../../src/app/main/applicationShortcutPolicy'

describe.each(['darwin', 'win32', 'linux'])('%s application shortcut policy', platform => {
  const input = (key = 'q', type = 'keyDown', extra = {}) => ({
    key,
    type,
    meta: platform === 'darwin',
    control: platform !== 'darwin',
    alt: false,
    shift: false,
    isAutoRepeat: false,
    ...extra,
  })
  it('consumes W without offering a window-close or quit action', () => {
    const policy = createApplicationShortcutPolicy(platform)
    expect(policy.handle(input('w'))).toEqual({ consumed: true, action: 'close-selected-node' })
    expect(policy.handle(input('w', 'keyDown', { isAutoRepeat: true }))).toEqual({ consumed: true })
    expect(policy.handle(input('w', 'keyUp'))).toEqual({ consumed: true })
  })
  it('requires two independent non-repeat Q presses and commits on the second press', () => {
    if (platform !== 'darwin') {
      return
    }
    const policy = createApplicationShortcutPolicy(platform)
    expect(policy.handle(input())).toEqual({ consumed: true, action: 'quit-armed' })
    expect(policy.handle(input('q', 'keyDown', { isAutoRepeat: true }))).toEqual({ consumed: true })
    expect(policy.handle(input())).toEqual({ consumed: true, action: 'quit' })
    expect(policy.handle(input())).toEqual({ consumed: true })
  })
  it('expires at the deadline and does not count held keys as confirmation', () => {
    if (platform !== 'darwin') {
      return
    }
    let now = 0
    const policy = createApplicationShortcutPolicy(platform, () => now)
    policy.handle(input())
    now = 1500
    expect(policy.handle(input()).action).toBe('quit-armed')
  })
  it.each(['reset', 'other-key', 'wrong-modifier'])('cancels confirmation on %s', reason => {
    if (platform !== 'darwin') {
      return
    }
    const policy = createApplicationShortcutPolicy(platform)
    policy.handle(input())
    if (reason === 'reset') {
      policy.reset()
    }
    if (reason === 'other-key') {
      policy.handle(input('x'))
    }
    if (reason === 'wrong-modifier') {
      policy.handle(input('q', 'keyDown', { meta: false, control: false }))
    }
    expect(policy.handle(input()).action).toBe('quit-armed')
  })
  it('does not capture extra modifiers or the other platform modifier', () => {
    const policy = createApplicationShortcutPolicy(platform)
    expect(policy.handle(input('w', 'keyDown', { shift: true })).consumed).toBe(false)
    expect(policy.handle(input('q', 'keyDown', { alt: true })).consumed).toBe(false)
    expect(
      policy.handle(
        input('w', 'keyDown', { meta: platform !== 'darwin', control: platform === 'darwin' }),
      ).consumed,
    ).toBe(false)
  })
  it('preserves Ctrl+Q, including terminal XON, on Windows and Linux', () => {
    if (platform === 'darwin') {
      return
    }
    const policy = createApplicationShortcutPolicy(platform)
    expect(policy.handle(input())).toEqual({ consumed: false })
    expect(policy.handle(input('q', 'keyUp'))).toEqual({ consumed: false })
    expect(policy.handle(input())).toEqual({ consumed: false })
  })
})
