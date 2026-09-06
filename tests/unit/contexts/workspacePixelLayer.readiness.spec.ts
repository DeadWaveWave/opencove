import { afterEach, describe, expect, it } from 'vitest'
import { readReadyPixelNodeIds } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/readiness'

const frame = {
  id: 'new-node',
  sessionId: 'session-1',
  rect: { x: 0, y: 0, width: 400, height: 300 },
}
function scene(html: string) {
  const scope = document.createElement('div')
  scope.innerHTML = `<div class="react-flow__node" data-id="new-node">${html}</div>`
  document.body.append(scope)
  return scope
}
afterEach(() => document.body.replaceChildren())

describe('pixel reveal presentation readiness', () => {
  it('starts the terminal frame without waiting for hydration or renderer startup', () => {
    const scope = scene(
      '<div class="terminal-node"><div class="terminal-node__terminal" aria-busy="true"><div class="xterm-screen"><canvas></canvas></div></div></div>',
    )
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([frame.id])
    scope.querySelector('.terminal-node__terminal')!.setAttribute('aria-busy', 'false')
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([frame.id])
    scope.querySelector('canvas')!.remove()
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([frame.id])
  })

  it('reveals terminal errors instead of hiding them behind a readiness wait', () => {
    const scope = scene(
      '<div class="terminal-node"><div class="terminal-node__error">Could not launch</div></div>',
    )
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([frame.id])
  })

  it('keeps document loading and error states independent of frame appearance', () => {
    const scope = scene(
      '<div class="document-node"><div class="document-node__state">Loading</div></div>',
    )
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([frame.id])
    scope.querySelector('.document-node__state')!.classList.add('document-node__state--error')
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([frame.id])
    scope.querySelector('.document-node')!.innerHTML = '<div class="monaco-editor"></div>'
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([frame.id])
  })

  it('starts the image frame while its file is still loading', () => {
    const scope = scene('<div class="image-node"><div data-image-missing="false"></div></div>')
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([frame.id])
    scope.querySelector('[data-image-missing]')!.setAttribute('data-image-missing', 'true')
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([frame.id])
  })

  it('accepts static content only after the actual node has entered the visible DOM', () => {
    const scope = scene('<div class="note-node"><textarea></textarea></div>')
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([frame.id])
    const node = scope.querySelector<HTMLElement>('.react-flow__node')!
    node.style.visibility = 'hidden'
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([])
    node.style.visibility = ''
    scope.remove()
    expect(readReadyPixelNodeIds(scope, [frame])).toEqual([])
  })
})
