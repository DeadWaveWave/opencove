import React from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApplicationShortcutEvent } from '../../../src/shared/contracts/applicationShortcut'
import { useCloseSelectedNodeShortcut } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCloseSelectedNodeShortcut'

vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
type Props = Parameters<typeof useCloseSelectedNodeShortcut>[0]
function Harness(props: Props) {
  useCloseSelectedNodeShortcut(props)
  return null
}

function fixture(selected = ['a'], kind = 'terminal') {
  let listener: (event: ApplicationShortcutEvent) => void = () => undefined
  const unsubscribe = vi.fn()
  vi.stubGlobal('opencoveApi', {
    lifecycle: {
      onApplicationShortcut: (handler: typeof listener) => {
        listener = handler
        return unsubscribe
      },
    },
  })
  const canvas = document.createElement('div')
  canvas.innerHTML =
    '<div class="react-flow__node" data-id="a"><input /></div><div class="react-flow__node" data-id="b"><input /></div>'
  document.body.append(canvas)
  const props: Props = {
    enabled: true,
    canvasRef: { current: canvas },
    selectedNodeIdsRef: { current: selected },
    nodesRef: {
      current: ['a', 'b'].map(id => ({ id, data: { kind } })) as Props['nodesRef']['current'],
    },
    closeNode: vi.fn().mockResolvedValue(undefined),
    onShowMessage: vi.fn(),
  }
  const result = render(<Harness {...props} />)
  return {
    props,
    canvas,
    result,
    unsubscribe,
    send: () => act(() => listener('close-selected-node')),
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})
describe('selected node close shortcut', () => {
  it('closes the focused input node without canvas selection', () => {
    const f = fixture([])
    f.canvas.querySelector('input')?.focus()
    f.send()
    expect(f.props.closeNode).toHaveBeenCalledExactlyOnceWith('a')
    f.result.unmount()
  })
  it.each([{ selected: ['a'] }, { selected: ['a', 'removed'] }])(
    'prefers the focused input over stale selection $selected',
    ({ selected }) => {
      const f = fixture(selected)
      f.canvas.querySelector<HTMLInputElement>('[data-id="b"] input')?.focus()
      f.send()
      expect(f.props.closeNode).toHaveBeenCalledExactlyOnceWith('b')
      f.result.unmount()
    },
  )
  it('does nothing with neither focus nor selection', () => {
    const f = fixture([])
    f.send()
    expect(f.props.closeNode).not.toHaveBeenCalled()
    expect(f.props.onShowMessage).not.toHaveBeenCalled()
    f.result.unmount()
  })
  it('ignores input focus outside this canvas', () => {
    const f = fixture([])
    const otherCanvas = document.createElement('div')
    otherCanvas.innerHTML = '<div class="react-flow__node" data-id="a"><input /></div>'
    document.body.append(otherCanvas)
    otherCanvas.querySelector('input')?.focus()
    f.send()
    expect(f.props.closeNode).not.toHaveBeenCalled()
    f.result.unmount()
  })
  it('does not close a hidden focused node', () => {
    const f = fixture([])
    f.props.nodesRef.current[0].hidden = true
    f.canvas.querySelector('input')?.focus()
    f.send()
    expect(f.props.closeNode).not.toHaveBeenCalled()
    f.result.unmount()
  })
  it('unsubscribes when the canvas is disabled', () => {
    const f = fixture([])
    f.canvas.querySelector('input')?.focus()
    f.result.rerender(<Harness {...f.props} enabled={false} />)
    expect(f.unsubscribe).toHaveBeenCalledOnce()
    expect(f.props.closeNode).not.toHaveBeenCalled()
    f.result.unmount()
  })
  it('closes only a single selected node and suppresses concurrent requests', async () => {
    const f = fixture()
    f.send()
    f.send()
    expect(f.props.closeNode).toHaveBeenCalledExactlyOnceWith('a')
    await act(async () => undefined)
    f.result.unmount()
    expect(f.unsubscribe).toHaveBeenCalledOnce()
  })
  it('uses actual focus in a multiselection, never array order', () => {
    const f = fixture(['a', 'b'])
    f.canvas.querySelector<HTMLInputElement>('[data-id="b"] input')?.focus()
    f.send()
    expect(f.props.closeNode).toHaveBeenCalledExactlyOnceWith('b')
    f.result.unmount()
  })
  it('explains ambiguous multiselection instead of deleting arbitrary nodes', () => {
    const f = fixture(['a', 'b'])
    f.send()
    expect(f.props.closeNode).not.toHaveBeenCalled()
    expect(f.props.onShowMessage).toHaveBeenCalledWith(
      'common.closeShortcutSelectWindow',
      'warning',
    )
    f.result.unmount()
  })
  it.each(['focus', 'selection'])(
    'delegates documents with %s to their save-before-close owner',
    mode => {
      const f = fixture(mode === 'selection' ? ['a'] : [], 'document')
      if (mode === 'focus') {
        f.canvas.querySelector('input')?.focus()
      }
      const button = document.createElement('button')
      button.className = 'document-node__close'
      const click = vi.fn()
      button.addEventListener('click', click)
      f.canvas.querySelector('[data-id="a"]')?.append(button)
      f.send()
      expect(click).toHaveBeenCalledOnce()
      expect(f.props.closeNode).not.toHaveBeenCalled()
      f.result.unmount()
    },
  )
  it('reports close failures and permits retry', async () => {
    const f = fixture()
    vi.mocked(f.props.closeNode).mockRejectedValue(new Error('close failed'))
    f.send()
    await act(async () => undefined)
    expect(f.props.onShowMessage).toHaveBeenCalledWith('common.closeShortcutFailed', 'error')
    f.send()
    expect(f.props.closeNode).toHaveBeenCalledTimes(2)
    await act(async () => undefined)
    f.result.unmount()
  })
  it('does not publish late failures after unmount', async () => {
    const f = fixture()
    let reject!: (reason: Error) => void
    vi.mocked(f.props.closeNode).mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        }),
    )
    f.send()
    f.result.unmount()
    await act(async () => reject(new Error('late failure')))
    expect(f.props.onShowMessage).not.toHaveBeenCalled()
  })
})
