import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { PluginNodePreview } from './PluginNodePreview'

beforeEach(() => {
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => undefined
  }
})

afterEach(() => vi.unstubAllGlobals())

describe('PluginNodePreview isolation', () => {
  it('uses the real window controls with sample data without querying Git or writing settings', async () => {
    const invoke = vi.fn()
    vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
    const initial = useAppStore.getState()
    useAppStore.setState({
      agentSettings: { ...initial.agentSettings, disabledPluginIds: ['git-board'] },
    })
    const onStoreChange = vi.fn()
    const unsubscribe = useAppStore.subscribe(onStoreChange)
    try {
      render(<PluginNodePreview pluginId="git-board" />)
      await screen.findByTestId('plugin-preview-node-plugin-preview-git-board')
      expect(screen.getByText('Refine plugin window controls')).toBeInTheDocument()
      expect(screen.getByTestId('plugin-preview-resizer-left')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('plugin-preview-refresh'))
      expect(screen.getByText('Polish the canvas preview')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('node-collapse'))
      expect(screen.getByTestId('collapsed-node-plugin-preview-git-board')).toBeInTheDocument()
      expect(
        screen.getByTestId('plugin-preview-node-plugin-preview-git-board').parentElement,
      ).toHaveAttribute('inert')
      fireEvent.click(screen.getByTestId('node-expand'))
      expect(
        screen.getByTestId('plugin-preview-node-plugin-preview-git-board').parentElement,
      ).not.toHaveAttribute('inert')

      fireEvent.click(screen.getByTestId('plugin-preview-close'))
      expect(screen.queryByTestId('plugin-preview-node-plugin-preview-git-board')).toBeNull()
      fireEvent.click(screen.getByTestId('plugin-preview-restore'))
      await screen.findByText('Refine plugin window controls')
      expect(screen.queryByText('Polish the canvas preview')).toBeNull()
      expect(invoke).not.toHaveBeenCalled()
      expect(onStoreChange).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
      useAppStore.setState(initial)
    }
  })

  it('resizes only the sample and resets its frame and disclosure state', async () => {
    render(<PluginNodePreview pluginId="git-board" />)
    const node = await screen.findByTestId('plugin-preview-node-plugin-preview-git-board')
    expect(node).toHaveStyle({ width: '520px', height: '292px' })
    fireEvent.pointerDown(screen.getByTestId('plugin-preview-resizer-bottom-right'), {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(window, { clientX: 24, clientY: 20 })
    fireEvent.pointerUp(window, { clientX: 24, clientY: 20 })
    await waitFor(() => expect(node).toHaveStyle({ width: '544px', height: '312px' }))
    fireEvent.click(screen.getByTestId('node-collapse'))
    fireEvent.click(screen.getByTestId('plugin-preview-reset'))
    await waitFor(() => expect(node).toHaveStyle({ width: '520px', height: '292px' }))
    expect(node.parentElement).not.toHaveAttribute('inert')
  })

  it('does not mount a live plugin as a fallback for unsupported preview kinds', () => {
    const invoke = vi.fn()
    vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
    render(<PluginNodePreview pluginId="unavailable-plugin" />)
    expect(screen.queryByTestId('plugin-node-preview')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })
})
