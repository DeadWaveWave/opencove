export interface WebglPixelSnapOffset {
  x: number
  y: number
}

function roundSnapOffset(value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return Math.abs(rounded) <= 0.001 ? 0 : rounded
}

function resolveAxisSnapOffset(position: number, devicePixelRatio: number): number {
  const devicePixelPosition = position * devicePixelRatio
  const delta = Math.round(devicePixelPosition) - devicePixelPosition
  return roundSnapOffset(delta / devicePixelRatio)
}

export function resolveWebglPixelSnapOffset(input: {
  x: number
  y: number
  devicePixelRatio: number
}): WebglPixelSnapOffset {
  if (
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y) ||
    !Number.isFinite(input.devicePixelRatio) ||
    input.devicePixelRatio <= 0
  ) {
    return { x: 0, y: 0 }
  }

  return {
    x: resolveAxisSnapOffset(input.x, input.devicePixelRatio),
    y: resolveAxisSnapOffset(input.y, input.devicePixelRatio),
  }
}

export function applyWebglPixelSnapping({
  container,
  rendererKind,
}: {
  container: HTMLElement | null
  rendererKind: 'webgl' | 'dom'
}): WebglPixelSnapOffset {
  const canvas =
    container?.querySelector('.xterm-screen canvas') instanceof HTMLCanvasElement
      ? (container.querySelector('.xterm-screen canvas') as HTMLCanvasElement)
      : null

  if (!canvas || rendererKind !== 'webgl' || typeof window === 'undefined') {
    if (canvas) {
      canvas.style.transform = ''
      canvas.style.transformOrigin = ''
    }
    return { x: 0, y: 0 }
  }

  const rect = canvas.getBoundingClientRect()
  const devicePixelRatio = window.devicePixelRatio
  const offset = resolveWebglPixelSnapOffset({
    x: rect.x,
    y: rect.y,
    devicePixelRatio,
  })

  if (offset.x === 0 && offset.y === 0) {
    canvas.style.transform = ''
    canvas.style.transformOrigin = ''
    return offset
  }

  canvas.style.transformOrigin = 'top left'
  canvas.style.transform = `translate(${offset.x}px, ${offset.y}px)`
  return offset
}
