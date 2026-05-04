function resolveWebglCanvas(container: HTMLElement | null): HTMLCanvasElement | null {
  const canvas = container?.querySelector('.xterm-screen canvas')
  return canvas instanceof HTMLCanvasElement ? canvas : null
}

export function clearWebglCanvasTransform({
  container,
  rendererKind,
}: {
  container: HTMLElement | null
  rendererKind: 'webgl' | 'dom'
}): boolean {
  const canvas = resolveWebglCanvas(container)
  if (!canvas) {
    return false
  }

  if (rendererKind !== 'webgl') {
    canvas.style.transform = ''
    canvas.style.transformOrigin = ''
    return false
  }

  const hadTransform = canvas.style.transform.length > 0 || canvas.style.transformOrigin.length > 0
  canvas.style.transform = ''
  canvas.style.transformOrigin = ''
  return hadTransform
}
