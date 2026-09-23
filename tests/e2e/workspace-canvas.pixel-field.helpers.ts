import { createHash } from 'node:crypto'
import { expect, type Locator } from '@playwright/test'

export async function readFieldSignature(layer: Locator) {
  const image = await layer.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
  return createHash('sha256').update(image).digest('hex')
}

export async function readStableFieldBaseline(layer: Locator) {
  // Chromium can switch canvas rasterization after repeated pixel readbacks. Warm that
  // test-only path before comparing output; leave the production animation context intact.
  /* eslint-disable no-await-in-loop -- Readbacks must observe successive rasterized frames. */
  for (let sample = 0; sample < 3; sample++) {
    await layer.evaluate(async element => {
      const canvas = element as HTMLCanvasElement
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Unable to sample the static pixel field')
      }
      context.getImageData(0, 0, canvas.width, canvas.height)
      // Repaint at the same geometry so a static canvas cannot retain the old GPU bitmap.
      window.dispatchEvent(new Event('resize'))
      await new Promise<void>(resolve => {
        let remaining = 4
        const next = () => {
          if (--remaining === 0) {
            resolve()
          } else {
            requestAnimationFrame(next)
          }
        }
        requestAnimationFrame(next)
      })
    })
    await readFieldSignature(layer)
  }
  /* eslint-enable no-await-in-loop */

  let previous: string | undefined
  await expect
    .poll(
      async () => {
        const current = await readFieldSignature(layer)
        const stable = current === previous
        previous = current
        return stable
      },
      { message: 'The static pixel field must finish rasterizing before taking its baseline' },
    )
    .toBe(true)
  if (!previous) {
    throw new Error('No stable pixel field was captured')
  }
  return previous
}
