import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceCreationActivation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/creationActivation'
import { focusPrimaryNodeContent } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/focusPrimaryNodeContent'
import { pixelNode } from './workspacePixelLayer.fixtures'

describe('input activation after successful local creation', () => {
  let scope: HTMLDivElement
  let nodes: ReturnType<typeof pixelNode>[]
  let activation: ReturnType<typeof createWorkspaceCreationActivation>
  let mutation: () => void
  let frames: Map<number, FrameRequestCallback>
  let hidden: boolean
  const flush = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(performance.now()))
    vi.advanceTimersByTime(0)
  }
  const mount = (id: string, content: string) => {
    const node = document.createElement('div')
    node.className = 'react-flow__node'
    node.dataset.id = id
    node.innerHTML = content
    scope.append(node)
    return node
  }
  beforeEach(() => {
    vi.useFakeTimers()
    hidden = false
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
      hidden ? 'hidden' : 'visible',
    )
    frames = new Map()
    let nextFrame = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++nextFrame, callback)
      return nextFrame
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames.delete(id)
    })
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: () => void) {
          mutation = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    scope = document.createElement('div')
    document.body.append(scope)
    nodes = []
    activation = createWorkspaceCreationActivation({ getScope: () => scope, getNodes: () => nodes })
  })
  afterEach(() => {
    activation.dispose()
    scope.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('activates real Note/Role/Website inputs and Task/Image frames without selecting windows', () => {
    const cases = [
      ['note', '<textarea data-testid="note-node-textarea"></textarea>', 'textarea'],
      ['role', '<textarea data-testid="role-node-input"></textarea>', 'textarea'],
      ['website', '<input class="website-node__address-input">', 'input'],
      ['task', '<div class="task-node"></div>', '.task-node'],
      ['image', '<div class="image-node"></div>', '.image-node'],
    ] as const
    for (const [kind, html, selector] of cases) {
      nodes.push({ ...pixelNode({ kind, sessionId: '' }), id: kind })
      const node = mount(kind, html)
      activation.request(kind)
      flush()
      expect(document.activeElement).toBe(node.querySelector(selector))
      expect(node.classList.contains('selected')).toBe(false)
      expect(nodes.some(candidate => candidate.selected)).toBe(false)
    }
  })

  it('waits for Monaco after the creation dialog closes and its focus restoration runs', () => {
    nodes = [{ ...pixelNode({ kind: 'document' }), id: 'doc' }]
    const node = mount('doc', '<div class="document-node"></div>')
    const oldInput = document.createElement('input')
    scope.append(oldInput)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    scope.append(dialog)
    activation.request('doc')
    flush()
    node.innerHTML =
      '<div class="document-node"><textarea data-testid="document-node-editor-input"></textarea></div>'
    mutation()
    flush()
    expect(document.activeElement).not.toBe(node.querySelector('textarea'))
    dialog.remove()
    window.setTimeout(() => oldInput.focus(), 0)
    mutation()
    flush()
    expect(document.activeElement).toBe(node.querySelector('textarea'))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves editing resumed during image import before its successful creation request', () => {
    nodes = [{ ...pixelNode({ kind: 'note' }), id: 'note' }]
    const note = mount('note', '<textarea data-testid="note-node-textarea"></textarea>')
    const editor = note.querySelector('textarea')!
    // This input happens during asynchronous image decoding, before a request exists.
    editor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    editor.focus()
    editor.value = 'Keep editing while the image imports'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    nodes.push({ ...pixelNode({ kind: 'image' }), id: 'image' })
    mount('image', '<div class="image-node"></div>')
    activation.request('image')
    flush()
    expect(document.activeElement).toBe(editor)
    expect(editor.value).toBe('Keep editing while the image imports')
    expect(vi.getTimerCount()).toBe(0)
    expect(nodes.some(candidate => candidate.selected)).toBe(false)
  })

  it.each(['pointerdown', 'keydown', 'blur'])(
    'cancels delayed focus on subsequent %s so it cannot steal focus',
    eventType => {
      nodes = [{ ...pixelNode({ kind: 'document' }), id: 'doc' }]
      const node = mount('doc', '<div class="document-node"></div>')
      const chosen = document.createElement('input')
      scope.append(chosen)
      chosen.focus()
      activation.request('doc')
      window.dispatchEvent(new Event(eventType))
      node.innerHTML = '<textarea data-testid="document-node-editor-input"></textarea>'
      mutation()
      flush()
      expect(document.activeElement).toBe(chosen)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('keeps Terminal/Agent autofocus with their existing owner and rejects background or expired requests', () => {
    for (const kind of ['terminal', 'agent'] as const) {
      nodes.push({ ...pixelNode({ kind }), id: kind })
      const node = mount(
        kind,
        '<div class="terminal-node__terminal"><textarea class="xterm-helper-textarea"></textarea></div>',
      )
      activation.request(kind)
      flush()
      expect(document.activeElement).not.toBe(node.querySelector('textarea'))
    }
    nodes.push({ ...pixelNode({ kind: 'note' }), id: 'note' })
    hidden = true
    activation.request('note')
    hidden = false
    const note = mount('note', '<textarea data-testid="note-node-textarea"></textarea>')
    flush()
    expect(document.activeElement).not.toBe(note.querySelector('textarea'))
    nodes.push({ ...pixelNode({ kind: 'document' }), id: 'late' })
    activation.request('late')
    vi.advanceTimersByTime(1001)
    const late = mount('late', '<textarea data-testid="document-node-editor-input"></textarea>')
    mutation()
    flush()
    expect(document.activeElement).not.toBe(late.querySelector('textarea'))
  })

  it('does not reactivate old or removed workspace nodes and preserves shortcut target order', () => {
    const node = mount('old', '<textarea data-testid="note-node-textarea"></textarea>')
    activation.request('old')
    flush()
    expect(document.activeElement).not.toBe(node.querySelector('textarea'))
    nodes = [{ ...pixelNode({ kind: 'note' }), id: 'old' }]
    activation.request('old')
    activation.dispose()
    flush()
    expect(document.activeElement).not.toBe(node.querySelector('textarea'))
    expect(focusPrimaryNodeContent(node)).toBe(true)
    expect(document.activeElement).toBe(node.querySelector('textarea'))
  })

  it('lets the newest local creation replace delayed focus without touching other canvases', () => {
    nodes = [
      { ...pixelNode({ kind: 'document' }), id: 'doc' },
      { ...pixelNode({ kind: 'note' }), id: 'note' },
    ]
    const doc = mount('doc', '<div class="document-node"></div>')
    const note = mount('note', '<textarea data-testid="note-node-textarea"></textarea>')
    activation.request('doc')
    activation.request('not-in-this-canvas')
    activation.request('note')
    flush()
    expect(document.activeElement).toBe(note.querySelector('textarea'))
    doc.innerHTML = '<textarea data-testid="document-node-editor-input"></textarea>'
    mutation()
    flush()
    expect(document.activeElement).toBe(note.querySelector('textarea'))
    expect(vi.getTimerCount()).toBe(0)
  })
})
