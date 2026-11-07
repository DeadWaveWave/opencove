import React, { createRef } from 'react'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { WorkspaceWindowSignals } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals'

vi.mock('@app/renderer/shell/utils/ptyEventHub', () => ({
  getPtyEventHub: () => ({ onState: () => () => {} }),
}))
const agent = (status: string, collapsed = false) =>
  [
    { id: 'a', data: { kind: 'agent', status, collapsePresentation: { collapsed } } },
  ] as Node<TerminalNodeData>[]

afterEach(() => document.body.replaceChildren())

describe('authoritative frame status', () => {
  it('projects restored waiting/failed states even with signals off, then clears on idle/removal', () => {
    const canvasRef = createRef<HTMLDivElement>()
    canvasRef.current = document.createElement('div')
    canvasRef.current.innerHTML = '<div class="react-flow__node" data-id="a"></div>'
    document.body.append(canvasRef.current)
    const node = canvasRef.current.firstElementChild as HTMLElement
    const props = { canvasRef, enabled: false }
    const view = render(<WorkspaceWindowSignals {...props} nodes={agent('waiting')} />)
    expect(node.dataset.coveWindowStatus).toBe('waiting')
    expect(node.querySelector('.cove-window-halo')?.getAttribute('aria-hidden')).toBe('true')
    expect(node.dataset.coveSignal).toBeUndefined()
    expect(canvasRef.current.dataset.coveFrameSignals).toBe('off')
    view.rerender(<WorkspaceWindowSignals {...props} nodes={agent('failed')} />)
    expect(node.dataset.coveWindowStatus).toBe('failed')
    expect(node.querySelector('.cove-window-halo')).toBeNull()
    view.rerender(<WorkspaceWindowSignals {...props} nodes={agent('standby')} />)
    expect(node.dataset.coveWindowStatus).toBeUndefined()
    view.rerender(<WorkspaceWindowSignals {...props} nodes={agent('waiting')} />)
    view.rerender(<WorkspaceWindowSignals {...props} nodes={[]} />)
    expect(node.querySelector('.cove-window-halo')).toBeNull()
    view.unmount()
    expect(canvasRef.current.dataset.coveFrameSignals).toBeUndefined()
  })
  it('does not halo collapsed windows and cleans detached frames at disposal', () => {
    const canvasRef = createRef<HTMLDivElement>()
    canvasRef.current = document.createElement('div')
    canvasRef.current.innerHTML = '<div class="react-flow__node" data-id="a"></div>'
    const node = canvasRef.current.firstElementChild as HTMLElement
    const props = { canvasRef, enabled: true }
    const view = render(<WorkspaceWindowSignals {...props} nodes={agent('waiting', true)} />)
    expect(node.querySelector('.cove-window-halo')).toBeNull()
    view.rerender(<WorkspaceWindowSignals {...props} nodes={agent('waiting')} />)
    expect(node.querySelector('.cove-window-halo')).not.toBeNull()
    node.remove()
    view.unmount()
    expect(node.querySelector('.cove-window-halo')).toBeNull()
    expect(node.dataset.coveWindowStatus).toBeUndefined()
  })
})
