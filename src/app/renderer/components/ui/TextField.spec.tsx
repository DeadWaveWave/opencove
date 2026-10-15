import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TextAreaField, TextField } from './TextField'

describe('TextField', () => {
  it('labels its input and reports edits', () => {
    const onChange = vi.fn()
    render(
      <TextField
        label="Task name"
        value=""
        placeholder="Enter a name"
        data-testid="task-name"
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Task name' })
    expect(input).toBe(screen.getByTestId('task-name'))
    expect(input).toHaveAttribute('placeholder', 'Enter a name')
    expect(input).toHaveClass('cove-field')
    fireEvent.change(input, { target: { value: 'Ship the menu' } })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('describes the input with its help text and its error, and marks it invalid', () => {
    const { rerender } = render(
      <TextField
        label="SSH port"
        value="22"
        description="The port the SSH server listens on."
        onChange={() => {}}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'SSH port' })
    expect(input).toHaveAccessibleDescription('The port the SSH server listens on.')
    expect(input).not.toHaveAttribute('aria-invalid')

    rerender(
      <TextField
        label="SSH port"
        value="abc"
        description="The port the SSH server listens on."
        error="Enter a number between 1 and 65535."
        onChange={() => {}}
      />,
    )
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(
      'The port the SSH server listens on. Enter a number between 1 and 65535.',
    )
    expect(input).toHaveAccessibleErrorMessage('Enter a number between 1 and 65535.')
  })

  it('keeps a caller id and renders an accessory beside the label', () => {
    render(
      <TextField
        id="custom-id"
        label="Requirement"
        labelAccessory={<button type="button">Templates</button>}
        value=""
        onChange={() => {}}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Requirement' })
    expect(input.id).toBe('custom-id')
    expect(screen.getByRole('button', { name: 'Templates' })).toBeTruthy()
  })
})

describe('TextAreaField', () => {
  it('is a labelled multi-line field', () => {
    const onChange = vi.fn()
    render(
      <TextAreaField
        label="Details"
        value=""
        placeholder="What happened?"
        data-testid="details"
        onChange={onChange}
      />,
    )
    const area = screen.getByRole('textbox', { name: 'Details' })
    expect(area.tagName).toBe('TEXTAREA')
    expect(area).toBe(screen.getByTestId('details'))
    fireEvent.change(area, { target: { value: 'It crashed' } })
    expect(onChange).toHaveBeenCalledOnce()
  })
})
