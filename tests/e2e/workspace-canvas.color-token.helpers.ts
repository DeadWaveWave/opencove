import type { Locator } from '@playwright/test'

/** Resolve hex, rgb and color-mix tokens through the same computed-color path as borders. */
export async function readComputedColorToken(scope: Locator, token: string): Promise<string> {
  return scope.evaluate((element, name) => {
    const probe = document.createElement('span')
    probe.hidden = true
    probe.style.color = getComputedStyle(element).getPropertyValue(name).trim()
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
}
