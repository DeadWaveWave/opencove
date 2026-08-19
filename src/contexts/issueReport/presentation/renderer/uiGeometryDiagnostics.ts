import type {
  IssueReportUiGeometryInput,
  RuntimeDiagnosticsDetailValue,
  UiDiagnosticBreadcrumbEvent,
} from '@shared/contracts/dto'

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100
}

let latestCanvasViewport: IssueReportUiGeometryInput['canvas']['viewport'] = null

function readRect(element: Element | null): IssueReportUiGeometryInput['canvas']['rect'] {
  if (!(element instanceof Element)) {
    return null
  }
  const rect = element.getBoundingClientRect()
  return {
    x: rounded(rect.x),
    y: rounded(rect.y),
    width: rounded(rect.width),
    height: rounded(rect.height),
  }
}

export function captureWindowGeometryDetails(): Record<string, RuntimeDiagnosticsDetailValue> {
  if (typeof window === 'undefined') {
    return {}
  }

  return {
    innerWidth: finite(window.innerWidth),
    innerHeight: finite(window.innerHeight),
    outerWidth: finite(window.outerWidth),
    outerHeight: finite(window.outerHeight),
    devicePixelRatio: finite(window.devicePixelRatio),
    visualViewportScale: finite(window.visualViewport?.scale),
  }
}

export function captureCanvasGeometryDetails(
  canvas: Element | null,
): Record<string, RuntimeDiagnosticsDetailValue> {
  const rect = readRect(canvas)
  return {
    canvasX: rect?.x ?? null,
    canvasY: rect?.y ?? null,
    canvasWidth: rect?.width ?? null,
    canvasHeight: rect?.height ?? null,
  }
}

export function recordUiGeometryBreadcrumb(
  event: UiDiagnosticBreadcrumbEvent,
  details: Record<string, RuntimeDiagnosticsDetailValue>,
): void {
  try {
    if (event === 'canvas-viewport-change') {
      const x = finite(details['x'])
      const y = finite(details['y'])
      const zoom = finite(details['zoom'])
      if (x !== null && y !== null && zoom !== null) {
        latestCanvasViewport = { x, y, zoom }
      }
    }
    window.opencoveApi.debug?.recordUiDiagnosticBreadcrumb({
      source: 'renderer-ui',
      event,
      details,
    })
  } catch {
    // Diagnostics collection must never affect app runtime behavior.
  }
}

function readCanvasViewportFromDom(): IssueReportUiGeometryInput['canvas']['viewport'] {
  const viewport = document.querySelector('.react-flow__viewport')
  const transform = viewport?.getAttribute('style')?.match(/transform:\s*([^;]+)/u)?.[1]
  if (!transform) {
    return null
  }

  const match = transform.match(
    /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)\s*scale\(\s*([\d.]+)\s*\)/u,
  )
  if (!match) {
    return null
  }

  const x = finite(Number(match[1]))
  const y = finite(Number(match[2]))
  const zoom = finite(Number(match[3]))
  return x !== null && y !== null && zoom !== null ? { x, y, zoom } : null
}

export function captureIssueReportUiGeometry(): IssueReportUiGeometryInput {
  const canvas = document.querySelector('.workspace-canvas')
  const windowGeometry = captureWindowGeometryDetails()
  const nodes = [...document.querySelectorAll('.react-flow__node[data-id]')]
    .slice(0, 100)
    .map(node => {
      const rect = node.getBoundingClientRect()
      return {
        id: node.getAttribute('data-id')?.slice(0, 256) ?? 'unknown',
        kind: node.getAttribute('data-type')?.slice(0, 80) ?? null,
        x: rounded(rect.x),
        y: rounded(rect.y),
        width: rounded(rect.width),
        height: rounded(rect.height),
      }
    })

  return {
    window: {
      innerWidth: finite(windowGeometry['innerWidth']),
      innerHeight: finite(windowGeometry['innerHeight']),
      outerWidth: finite(windowGeometry['outerWidth']),
      outerHeight: finite(windowGeometry['outerHeight']),
      devicePixelRatio: finite(windowGeometry['devicePixelRatio']),
      visualViewportScale: finite(windowGeometry['visualViewportScale']),
    },
    canvas: {
      rect: readRect(canvas),
      viewport: latestCanvasViewport ?? readCanvasViewportFromDom(),
    },
    nodes,
  }
}
