import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

const OPTIONS = [
  { value: 'bug', label: 'Bug report', testId: 'kind-bug' },
  { value: 'feature', label: 'Feature request', testId: 'kind-feature' },
  { value: 'other', label: 'Other', testId: 'kind-other' },
] as const

describe('SegmentedControl', () => {
  it('is a named radio group whose segments report the chosen value', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <SegmentedControl
        label="Report type"
        value="bug"
        options={OPTIONS}
        onValueChange={onValueChange}
      />,
    )

    const group = screen.getByRole('radiogroup', { name: 'Report type' })
    const bug = screen.getByRole('radio', { name: 'Bug report' })
    const feature = screen.getByRole('radio', { name: 'Feature request' })
    expect(group.contains(bug)).toBe(true)
    expect(bug).toBeChecked()
    expect(feature).not.toBeChecked()
    expect(screen.getByTestId('kind-feature')).toBe(feature)

    fireEvent.click(screen.getByText('Feature request'))
    expect(onValueChange).toHaveBeenCalledWith('feature')

    rerender(
      <SegmentedControl
        label="Report type"
        value="feature"
        options={OPTIONS}
        onValueChange={onValueChange}
      />,
    )
    expect(feature).toBeChecked()
    expect(bug).not.toBeChecked()
  })

  it('names icon-only segments and keeps disabled semantics', () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        label="View"
        value="icons"
        disabled
        options={[
          { value: 'icons', label: 'Icons', icon: <svg />, iconOnly: true },
          { value: 'list', label: 'List', icon: <svg />, iconOnly: true },
        ]}
        onValueChange={onValueChange}
      />,
    )

    const list = screen.getByRole('radio', { name: 'List' })
    expect(list).toBeDisabled()
    expect(screen.queryByText('List')).toBeNull()
    fireEvent.click(list)
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('groups segments by a unique name so two controls never share a selection', () => {
    render(
      <>
        <SegmentedControl
          label="A"
          value="x"
          options={[{ value: 'x', label: 'X' }]}
          onValueChange={() => {}}
        />
        <SegmentedControl
          label="B"
          value="x"
          options={[{ value: 'x', label: 'X' }]}
          onValueChange={() => {}}
        />
      </>,
    )
    const [first, second] = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(first.name).not.toBe('')
    expect(first.name).not.toBe(second.name)
  })
})
