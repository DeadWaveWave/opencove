export async function readTerminalGeometry(page, nodeId, sessionId) {
  return await page.evaluate(
    async ({ currentNodeId, currentSessionId }) => {
      const api = window.__opencoveTerminalSelectionTestApi
      const flowNode = [...document.querySelectorAll('.react-flow__node')].find(node => {
        return node instanceof HTMLElement && node.getAttribute('data-id') === currentNodeId
      })
      const terminalNode =
        flowNode instanceof HTMLElement ? flowNode.querySelector('.terminal-node') : null
      const container =
        terminalNode instanceof HTMLElement
          ? terminalNode.querySelector('.terminal-node__terminal')
          : null
      const xterm = container instanceof HTMLElement ? container.querySelector('.xterm') : null
      const screen = xterm instanceof HTMLElement ? xterm.querySelector('.xterm-screen') : null
      const canvas = screen instanceof HTMLElement ? screen.querySelector('canvas') : null
      const rect = element => {
        if (!(element instanceof HTMLElement)) {
          return null
        }
        const box = element.getBoundingClientRect()
        return {
          width: box.width,
          height: box.height,
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
          offsetWidth: element.offsetWidth,
          offsetHeight: element.offsetHeight,
        }
      }
      const terminalSize = api?.getSize?.(currentNodeId) ?? null
      const proposedGeometry = api?.getProposedGeometry?.(currentNodeId) ?? null
      const renderMetrics = api?.getRenderMetrics?.(currentNodeId) ?? null
      const reactFlowViewport = document.querySelector('.react-flow__viewport')
      const viewportTransform =
        reactFlowViewport instanceof HTMLElement ? reactFlowViewport.style.transform : ''
      const viewportZoomMatch = viewportTransform.match(
        /translate\([^)]*\)\s+scale\((-?\d+(?:\.\d+)?)\)/,
      )
      const viewportZoom = viewportZoomMatch ? Number.parseFloat(viewportZoomMatch[1]) : null
      const snapshot = await window.opencoveApi.pty
        .presentationSnapshot({ sessionId: currentSessionId })
        .catch(() => null)
      const screenRect = rect(screen)
      const canvasRect = rect(canvas)
      const styleSize = element => {
        if (!(element instanceof HTMLElement)) {
          return null
        }

        const width = Number.parseFloat(element.style.width)
        const height = Number.parseFloat(element.style.height)
        return {
          width: Number.isFinite(width) ? width : null,
          height: Number.isFinite(height) ? height : null,
        }
      }
      const contentWidth =
        terminalSize && renderMetrics?.cssCellWidth
          ? terminalSize.cols * renderMetrics.cssCellWidth
          : null
      const contentHeight =
        terminalSize && renderMetrics?.cssCellHeight
          ? terminalSize.rows * renderMetrics.cssCellHeight
          : null
      return {
        nodeId: currentNodeId,
        sessionId: currentSessionId,
        windowDevicePixelRatio: window.devicePixelRatio,
        viewportZoom,
        viewportTransform,
        terminalSize,
        proposedGeometry,
        snapshotSize: snapshot ? { cols: snapshot.cols, rows: snapshot.rows } : null,
        renderMetrics,
        flowNodeRect: rect(flowNode),
        terminalNodeRect: rect(terminalNode),
        terminalNodeStyleSize: styleSize(terminalNode),
        containerRect: rect(container),
        xtermRect: rect(xterm),
        screenRect,
        canvasRect,
        canvasAttributeSize:
          canvas instanceof HTMLCanvasElement
            ? { width: canvas.width, height: canvas.height }
            : null,
        canvasStyle:
          canvas instanceof HTMLCanvasElement
            ? {
                width: canvas.style.width,
                height: canvas.style.height,
                transform: canvas.style.transform,
                transformOrigin: canvas.style.transformOrigin,
              }
            : null,
        horizontalOverflowPx:
          contentWidth === null || !screenRect
            ? null
            : Math.max(0, contentWidth - screenRect.clientWidth),
        verticalOverflowPx:
          contentHeight === null || !screenRect
            ? null
            : Math.max(0, contentHeight - screenRect.clientHeight),
        canvasOverflowX:
          canvasRect && screenRect
            ? Math.max(0, canvasRect.clientWidth - screenRect.clientWidth)
            : null,
        canvasOverflowY:
          canvasRect && screenRect
            ? Math.max(0, canvasRect.clientHeight - screenRect.clientHeight)
            : null,
      }
    },
    { currentNodeId: nodeId, currentSessionId: sessionId },
  )
}

export function assertOpenCodeWebglGeometry(geometry, options = {}) {
  const label = `${geometry.nodeId}/${geometry.sessionId}`
  if (!geometry.canvasRect || !geometry.canvasAttributeSize) {
    throw new Error(`[opencode-webgl-layout] OpenCode is not using WebGL canvas: ${label}`)
  }
  if (
    options.expectCanonicalFrameWidth &&
    typeof geometry.terminalNodeStyleSize?.width === 'number' &&
    geometry.terminalNodeStyleSize.width >= 650
  ) {
    throw new Error(
      `[opencode-webgl-layout] OpenCode node was widened instead of using measured geometry: ${JSON.stringify(geometry)}`,
    )
  }
  if (
    geometry.terminalSize &&
    geometry.proposedGeometry &&
    (geometry.terminalSize.cols !== geometry.proposedGeometry.cols ||
      geometry.terminalSize.rows !== geometry.proposedGeometry.rows)
  ) {
    throw new Error(`[opencode-webgl-layout] measured size mismatch: ${JSON.stringify(geometry)}`)
  }
  if (
    geometry.terminalSize &&
    geometry.snapshotSize &&
    (geometry.terminalSize.cols !== geometry.snapshotSize.cols ||
      geometry.terminalSize.rows !== geometry.snapshotSize.rows)
  ) {
    throw new Error(
      `[opencode-webgl-layout] PTY snapshot size mismatch: ${JSON.stringify(geometry)}`,
    )
  }
  if ((geometry.horizontalOverflowPx ?? 0) > 1 || (geometry.verticalOverflowPx ?? 0) > 1) {
    throw new Error(
      `[opencode-webgl-layout] terminal content overflow: ${JSON.stringify(geometry)}`,
    )
  }
  if ((geometry.canvasOverflowX ?? 0) > 1 || (geometry.canvasOverflowY ?? 0) > 1) {
    throw new Error(`[opencode-webgl-layout] WebGL canvas overflow: ${JSON.stringify(geometry)}`)
  }
  if (geometry.canvasStyle?.transform) {
    throw new Error(
      `[opencode-webgl-layout] unexpected WebGL canvas transform: ${JSON.stringify(geometry)}`,
    )
  }
  const effectiveDpr = geometry.renderMetrics?.effectiveDpr
  if (
    typeof effectiveDpr !== 'number' ||
    Math.abs(effectiveDpr - geometry.windowDevicePixelRatio) > 0.01
  ) {
    throw new Error(
      `[opencode-webgl-layout] WebGL DPR must follow native window DPR, not React Flow zoom: ${JSON.stringify(geometry)}`,
    )
  }
  if (geometry.canvasAttributeSize && geometry.canvasRect) {
    const expectedDeviceWidth = geometry.canvasRect.clientWidth * geometry.windowDevicePixelRatio
    const expectedDeviceHeight = geometry.canvasRect.clientHeight * geometry.windowDevicePixelRatio
    if (
      Math.abs(geometry.canvasAttributeSize.width - expectedDeviceWidth) > 1 ||
      Math.abs(geometry.canvasAttributeSize.height - expectedDeviceHeight) > 1
    ) {
      throw new Error(
        `[opencode-webgl-layout] WebGL backing canvas is not native-DPR aligned: ${JSON.stringify(geometry)}`,
      )
    }
  }
}
