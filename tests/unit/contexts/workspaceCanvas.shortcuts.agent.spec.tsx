import React, { useRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReactFlowProvider } from '@xyflow/react'
import type { KeybindingOverrides } from '../../../src/contexts/settings/domain/keybindings'
import { FolderNode } from '../../../src/contexts/workspace/presentation/renderer/components/FolderNode'
import { useWorkspaceCanvasShortcuts } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts'

function Harness({
  createAgent,
  platform = 'darwin',
  enabled = true,
  overrides = {},
  children,
}: {
  createAgent: () => Promise<void>
  platform?: string
  enabled?: boolean
  overrides?: KeybindingOverrides
  children?: React.ReactNode
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  useWorkspaceCanvasShortcuts({
    enabled,
    platform,
    keybindings: overrides,
    disableWhenTerminalFocused: false,
    activeSpaceId: null,
    spaces: [],
    nodesRef: useRef([]),
    canvasRef,
    createSpaceFromSelectedNodes: vi.fn(),
    createNoteAtViewportCenter: vi.fn(),
    createTerminalAtViewportCenter: vi.fn(async () => undefined),
    createAgentAtViewportCenter: createAgent,
    activateSpace: vi.fn(),
    navigateNode: vi.fn(),
    navigateSpace: vi.fn(),
  })
  return (
    <div>
      <button data-testid="sidebar">Project</button>
      <div ref={canvasRef} tabIndex={-1} data-testid="canvas">
        <button data-testid="node-header">Agent header</button>
        {children}
      </div>
    </div>
  )
}

function press(target: EventTarget, options: KeyboardEventInit = {}, prevented = false) {
  const event = new KeyboardEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  })
  if (prevented) {
    event.preventDefault()
  }
  target.dispatchEvent(event)
  return event
}

describe('canvas Agent shortcut ownership', () => {
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it.each(['darwin', 'win32', 'linux'])('starts once with the platform modifier: %s', platform => {
    const createAgent = vi.fn(async () => undefined)
    const { getByTestId } = render(<Harness createAgent={createAgent} platform={platform} />)
    const canvas = getByTestId('canvas')
    canvas.focus()
    const event = press(canvas, {
      metaKey: platform === 'darwin',
      ctrlKey: platform !== 'darwin',
    })
    expect(event.defaultPrevented).toBe(true)
    expect(createAgent).toHaveBeenCalledTimes(1)
  })

  it('accepts body dispatch only while the canvas owns actual focus', () => {
    const createAgent = vi.fn(async () => undefined)
    const { getByTestId } = render(<Harness createAgent={createAgent} />)
    expect(press(document.body).defaultPrevented).toBe(false)
    getByTestId('canvas').focus()
    expect(press(document.body).defaultPrevented).toBe(true)
    getByTestId('sidebar').focus()
    expect(press(document.body).defaultPrevented).toBe(false)
    expect(press(getByTestId('sidebar')).defaultPrevented).toBe(false)
    expect(createAgent).toHaveBeenCalledTimes(1)
  })

  it('allows a focused non-input node header', () => {
    const createAgent = vi.fn(async () => undefined)
    const { getByTestId } = render(<Harness createAgent={createAgent} />)
    const header = getByTestId('node-header')
    header.focus()
    expect(press(header).defaultPrevented).toBe(true)
    expect(createAgent).toHaveBeenCalledTimes(1)
  })

  it('does not start an Agent when the real folder node focus container owns focus', () => {
    const createAgent = vi.fn(async () => undefined)
    const { getByTestId } = render(
      <Harness createAgent={createAgent}>
        <ReactFlowProvider>
          <FolderNode
            id="folder-focus"
            title="docs"
            folder={{
              uri: 'file:///project/docs',
              rootUri: 'file:///project',
              viewMode: 'icons',
              expandedDirectoryUris: [],
            }}
            mountId={undefined}
            position={{ x: 0, y: 0 }}
            width={480}
            height={400}
            onFolderChange={vi.fn()}
            onOpenFile={vi.fn()}
            onClose={vi.fn()}
            onResize={vi.fn()}
            findBlockingOpenDocument={() => null}
          />
        </ReactFlowProvider>
      </Harness>,
    )
    const folder = getByTestId('folder-node-folder-focus')
    folder.focus()
    expect(document.activeElement).toBe(folder)
    expect(press(folder).defaultPrevented).toBe(false)
    expect(press(document.body).defaultPrevented).toBe(false)
    expect(createAgent).not.toHaveBeenCalled()
  })

  it.each([
    '<input />',
    '<textarea></textarea>',
    '<select><option>One</option></select>',
    '<div contenteditable="true" tabindex="0">Editable</div>',
    '<div contenteditable="" tabindex="0">Editable</div>',
    '<div contenteditable="plaintext-only" tabindex="0">Editable</div>',
    '<div data-cove-focus-scope="terminal" tabindex="0">Terminal</div>',
    '<div data-cove-focus-scope="document-editor" tabindex="0">Editor</div>',
    '<div class="monaco-editor" tabindex="0">Editor</div>',
    '<div class="workspace-space-explorer" tabindex="0">Files</div>',
    '<div class="workspace-space-quick-preview" tabindex="0">Preview</div>',
    '<div role="menu" tabindex="0">Menu</div>',
  ])('preserves native keyboard handling with terminal opt-out disabled: %s', markup => {
    const createAgent = vi.fn(async () => undefined)
    const { getByTestId } = render(<Harness createAgent={createAgent} />)
    const canvas = getByTestId('canvas')
    canvas.insertAdjacentHTML('beforeend', markup)
    const input = canvas.lastElementChild as HTMLElement
    input.focus()
    expect(document.activeElement).toBe(input)
    expect(press(input).defaultPrevented).toBe(false)
    expect(press(document.body).defaultPrevented).toBe(false)
    expect(createAgent).not.toHaveBeenCalled()
  })

  it.each([
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { altKey: true },
    { shiftKey: true },
  ])('ignores key repetition, IME, and different chords: %j', options => {
    const createAgent = vi.fn(async () => undefined)
    const { getByTestId } = render(<Harness createAgent={createAgent} />)
    const canvas = getByTestId('canvas')
    canvas.focus()
    expect(press(canvas, options).defaultPrevented).toBe(false)
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('does not claim a prevented event, modal, hidden or inert canvas', () => {
    const createAgent = vi.fn(async () => undefined)
    const { getByTestId } = render(<Harness createAgent={createAgent} />)
    const canvas = getByTestId('canvas')
    canvas.focus()
    press(canvas, {}, true)
    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    document.body.append(dialog)
    expect(press(canvas).defaultPrevented).toBe(false)
    dialog.remove()
    canvas.setAttribute('inert', '')
    expect(press(canvas).defaultPrevented).toBe(false)
    canvas.removeAttribute('inert')
    canvas.setAttribute('aria-hidden', 'true')
    expect(press(canvas).defaultPrevented).toBe(false)
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('respects disabled shortcuts, unassignment, and a user override', () => {
    const createAgent = vi.fn(async () => undefined)
    const { getByTestId, rerender } = render(<Harness createAgent={createAgent} enabled={false} />)
    const canvas = getByTestId('canvas')
    canvas.focus()
    expect(press(canvas).defaultPrevented).toBe(false)
    rerender(
      <Harness createAgent={createAgent} overrides={{ 'workspaceCanvas.createAgent': null }} />,
    )
    expect(press(canvas).defaultPrevented).toBe(false)
    rerender(
      <Harness
        createAgent={createAgent}
        overrides={{
          'workspaceCanvas.createAgent': {
            code: 'KeyL',
            metaKey: true,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
          },
        }}
      />,
    )
    expect(press(canvas).defaultPrevented).toBe(false)
    expect(press(canvas, { code: 'KeyL', key: 'l' }).defaultPrevented).toBe(true)
    expect(createAgent).toHaveBeenCalledTimes(1)
  })
})
