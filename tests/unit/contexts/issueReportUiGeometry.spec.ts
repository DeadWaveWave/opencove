import { afterEach, describe, expect, it } from 'vitest'
import { captureIssueReportUiGeometry } from '../../../src/contexts/issueReport/presentation/renderer/uiGeometryDiagnostics'

afterEach(() => {
  document.body.replaceChildren()
})

describe('issue report UI geometry', () => {
  it('captures canvas viewport and visible node rectangles from the rendered UI', () => {
    const canvas = document.createElement('div')
    canvas.className = 'workspace-canvas'
    const viewport = document.createElement('div')
    viewport.className = 'react-flow__viewport'
    viewport.setAttribute('style', 'transform: translate(14px, -20px) scale(0.8);')
    const node = document.createElement('div')
    node.className = 'react-flow__node'
    node.setAttribute('data-id', 'node-1')
    node.setAttribute('data-type', 'terminal')
    Object.defineProperty(node, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 30, y: 40, width: 600, height: 360 }),
    })
    canvas.append(viewport, node)
    document.body.append(canvas)

    const geometry = captureIssueReportUiGeometry()

    expect(geometry.canvas.viewport).toEqual({ x: 14, y: -20, zoom: 0.8 })
    expect(geometry.nodes).toEqual([
      { id: 'node-1', kind: 'terminal', x: 30, y: 40, width: 600, height: 360 },
    ])
    expect(geometry.window.devicePixelRatio).toBeGreaterThan(0)
  })
})
