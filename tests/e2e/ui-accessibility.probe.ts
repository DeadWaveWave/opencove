/**
 * In-page WCAG probe: text contrast (4.5:1, 3:1 for large text; disabled controls exempt) and
 * target size (24×24 CSS px, WCAG 2.5.8). Runs through page.evaluate, so it must stay
 * self-contained: no imports and no references to module scope.
 */
export interface UiAccessibilityReport {
  textCount: number
  targetCount: number
  failingText: Array<{
    text: string
    ratio: number
    required: number
    fg: string
    bg: string
    path: string
  }>
  smallTargets: Array<{ label: string; width: number; height: number; path: string }>
}

export function auditUiAccessibility({
  scope = 'body',
}: { scope?: string } = {}): UiAccessibilityReport {
  type Rgba = [number, number, number, number]
  const canvas = document.createElement('canvas').getContext('2d')!
  const parse = (value: string): Rgba => {
    if (!value || value === 'transparent') {
      return [0, 0, 0, 0]
    }
    const rgb = value.match(/^rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\)$/)
    if (rgb) {
      return [
        Number(rgb[1]),
        Number(rgb[2]),
        Number(rgb[3]),
        rgb[4] === undefined ? 1 : Number(rgb[4]),
      ]
    }
    // Other syntaxes (color(srgb …), oklch …) resolve through the canvas.
    canvas.clearRect(0, 0, 1, 1)
    canvas.fillStyle = '#000'
    canvas.fillStyle = value
    canvas.fillRect(0, 0, 1, 1)
    const data = canvas.getImageData(0, 0, 1, 1).data
    return [data[0]!, data[1]!, data[2]!, data[3]! / 255]
  }
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const alpha = top[3] + bottom[3] * (1 - top[3])
    if (alpha === 0) {
      return [0, 0, 0, 0]
    }
    const channel = (index: number) =>
      (top[index]! * top[3] + bottom[index]! * bottom[3] * (1 - top[3])) / alpha
    return [channel(0), channel(1), channel(2), alpha]
  }
  const luminance = (color: Rgba) => {
    const linear = (value: number) => {
      const s = value / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2])
  }
  const contrast = (a: Rgba, b: Rgba) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (high! + 0.05) / (low! + 0.05)
  }
  const page = parse(getComputedStyle(document.body).backgroundColor)
  const backgroundBehind = (element: Element): Rgba => {
    const layers: Rgba[] = []
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor)
      if (color[3] > 0) {
        layers.push(color)
        if (color[3] >= 0.995) {
          break
        }
      }
    }
    let result: Rgba = page[3] > 0 ? [page[0], page[1], page[2], 1] : [0, 0, 0, 1]
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      result = over(layers[index]!, result)
    }
    return result
  }
  const rendered = (element: Element, allowTransparentSelf: boolean) => {
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) {
      return false
    }
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.visibility === 'hidden' || style.display === 'none') {
        return false
      }
      if (Number(style.opacity) === 0 && !(allowTransparentSelf && node === element)) {
        return false
      }
      if (node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') {
        return false
      }
    }
    return true
  }
  const pathOf = (element: Element) => {
    const parts: string[] = []
    let node: Element | null = element
    for (let depth = 0; node && depth < 3; depth += 1) {
      const first = (node.getAttribute('class') ?? '').split(/\s+/).find(Boolean)
      parts.unshift(first ? `.${first}` : node.tagName.toLowerCase())
      node = node.parentElement
    }
    return parts.join(' > ')
  }
  const root = document.querySelector(scope)
  if (!root) {
    throw new Error(`auditUiAccessibility: no element matches ${scope}`)
  }

  const failingText: UiAccessibilityReport['failingText'] = []
  let textCount = 0
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const ownText = Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent ?? '')
      .join('')
      .trim()
    if (!ownText || !rendered(element, false)) {
      continue
    }
    textCount += 1
    if (element.closest(':disabled, [aria-disabled="true"], [data-disabled]')) {
      continue
    }
    const style = getComputedStyle(element)
    let opacity = 1
    for (let node: Element | null = element; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    const background = backgroundBehind(element)
    const color = parse(style.color)
    const foreground = over([color[0], color[1], color[2], color[3] * opacity], background)
    const size = Number.parseFloat(style.fontSize)
    const bold = (Number(style.fontWeight) || 400) >= 700
    const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
    const ratio = contrast(foreground, background)
    if (ratio < required) {
      failingText.push({
        text: ownText.slice(0, 40),
        ratio: Math.round(ratio * 100) / 100,
        required,
        fg: foreground.slice(0, 3).map(Math.round).join(','),
        bg: background.slice(0, 3).map(Math.round).join(','),
        path: pathOf(element),
      })
    }
  }

  const targets = Array.from(
    root.querySelectorAll(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="menuitem"], [role="switch"], [role="tab"], [role="option"]',
    ),
  ).filter(element => rendered(element, true))
  const smallTargets = targets
    .map(element => {
      const rect = element.getBoundingClientRect()
      return {
        label:
          element.getAttribute('aria-label') ?? (element.textContent ?? '').trim().slice(0, 32),
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        path: pathOf(element),
      }
    })
    .filter(target => Math.min(target.width, target.height) < 24)

  return { textCount, targetCount: targets.length, failingText, smallTargets }
}
