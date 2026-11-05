import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isShowcaseMode,
  setShowcaseMode,
  subscribeShowcaseMode,
} from '../../../src/app/renderer/shell/showcase/showcaseMode'

afterEach(() => {
  setShowcaseMode(false)
})

describe('showcase mode', () => {
  it('marks the document while on and tells subscribers once per change', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeShowcaseMode(listener)
    setShowcaseMode(true)
    setShowcaseMode(true)
    expect(isShowcaseMode()).toBe(true)
    expect(document.documentElement.hasAttribute('data-cove-showcase')).toBe(true)
    setShowcaseMode(false)
    expect(document.documentElement.hasAttribute('data-cove-showcase')).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('leaves on Escape, unless something open used the key first', () => {
    setShowcaseMode(true)
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    handled.preventDefault()
    window.dispatchEvent(handled)
    expect(isShowcaseMode()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(isShowcaseMode()).toBe(false)
  })

  it('stops listening for Escape once off', () => {
    setShowcaseMode(true)
    setShowcaseMode(false)
    const listener = vi.fn()
    subscribeShowcaseMode(listener)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(listener).not.toHaveBeenCalled()
  })
})
