import { render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useApplyUiFontScale } from './useApplyUiFontScale'

function Host({ size }: { size: number }) {
  useApplyUiFontScale(size)
  return null
}

afterEach(() => {
  document.documentElement.removeAttribute('style')
})

it('keeps the user font preference separate from theme typography and terminal fonts', () => {
  const root = document.documentElement
  const dispatch = vi.spyOn(window, 'dispatchEvent')
  root.style.setProperty('--cove-theme-font-scale', '1.125')
  root.style.setProperty('--cove-terminal-font-size', '15px')
  const { rerender } = render(<Host size={20} />)
  expect(root.style.getPropertyValue('--cove-user-font-scale')).toBe('1.25')
  expect(root.style.getPropertyValue('--cove-theme-font-scale')).toBe('1.125')
  expect(root.style.getPropertyValue('--cove-ui-font-scale')).toBe('')
  rerender(<Host size={16} />)
  expect(root.style.getPropertyValue('--cove-user-font-scale')).toBe('1.00')
  expect(root.style.getPropertyValue('--cove-terminal-font-size')).toBe('15px')
  expect(dispatch).toHaveBeenCalledTimes(2)
  expect(dispatch).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'opencove-ui-font-scale-changed' }),
  )
  rerender(<Host size={16} />)
  expect(dispatch).toHaveBeenCalledTimes(2)
  dispatch.mockRestore()
})
