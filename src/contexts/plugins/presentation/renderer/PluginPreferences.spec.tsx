import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../../domain/pluginTypes'
import { PluginPreferences } from './PluginPreferences'

const plugin: PluginManifest = {
  id: 'preferences',
  version: '1.0.0',
  revision: 'one',
  displayName: 'Preferences',
  description: '',
  nodeKinds: [],
  actionBar: false,
  contextMenu: false,
  preferences: [
    { id: 'count', title: 'Count', type: 'number', default: 2, minimum: 0, maximum: 10 },
  ],
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('rejects an empty numeric field and restores the saved value without a write', async () => {
  const invoke = vi.fn(async () => ({ count: 2 }))
  vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
  render(<PluginPreferences plugin={plugin} />)
  const field = await screen.findByLabelText('Count')
  fireEvent.change(field, { target: { value: '' } })
  fireEvent.blur(field)
  expect(field).toHaveValue(2)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alert')).toBeVisible()
})
it('ignores old save completion when a new plugin revision has loaded', async () => {
  let complete!: (value: unknown) => void
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({ count: 2 })
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve
        }),
    )
    .mockResolvedValueOnce({ count: 9 })
  vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
  const { rerender } = render(<PluginPreferences plugin={plugin} />)
  fireEvent.change(await screen.findByLabelText('Count'), { target: { value: '3' } })
  fireEvent.blur(screen.getByLabelText('Count'))
  rerender(<PluginPreferences plugin={{ ...plugin, revision: 'two' }} />)
  await waitFor(() => expect(screen.getByLabelText('Count')).toHaveValue(9))
  await act(async () => complete({ count: 3 }))
  expect(screen.getByLabelText('Count')).toHaveValue(9)
})
it('shows a loading failure without a permanent loading status', async () => {
  const invoke = vi.fn().mockRejectedValue(new Error('Preference read failed'))
  vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
  render(<PluginPreferences plugin={plugin} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Preference read failed')
  expect(screen.queryByText('Loading...')).toBeNull()
})
