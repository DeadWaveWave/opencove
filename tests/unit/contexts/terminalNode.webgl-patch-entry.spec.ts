import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

interface WebglAddonModule {
  readonly WebglAddon: {
    readonly prototype: {
      readonly setRasterScale?: unknown
    }
  }
}

describe('xterm WebGL patched package entries', () => {
  it('exposes raster scaling through both the CJS main and ESM module entries', async () => {
    const require = createRequire(import.meta.url)
    const cjsEntry = require.resolve('@xterm/addon-webgl')
    const cjsModule = require(cjsEntry) as WebglAddonModule
    const esmEntry = pathToFileURL(join(dirname(cjsEntry), 'addon-webgl.mjs')).href
    const esmModule = (await import(/* @vite-ignore */ esmEntry)) as WebglAddonModule

    expect(cjsModule.WebglAddon.prototype.setRasterScale).toBeTypeOf('function')
    expect(esmModule.WebglAddon.prototype.setRasterScale).toBeTypeOf('function')
  })

  it('keeps integer device cells and derives the canvas from the terminal grid', () => {
    const patch = readFileSync(
      join(process.cwd(), 'patches/@xterm__addon-webgl@0.19.0.patch'),
      'utf8',
    )

    expect(patch).toContain('t.cell.width=Math.max(1,Math.round(t.cell.width*i));')
    expect(patch).toContain('t.cell.height=Math.max(1,Math.round(t.cell.height*i));')
    expect(patch).toContain('t.canvas.width=this._terminal.cols*t.cell.width;')
    expect(patch).toContain('t.canvas.height=this._terminal.rows*t.cell.height;')
    expect(patch).toContain(
      'this.dimensions.device.cell.width = Math.max(1, Math.round(layoutDeviceCellWidth * this._rasterScale));',
    )
    expect(patch).toContain(
      'this.dimensions.device.cell.height = Math.max(1, Math.round(layoutDeviceCellHeight * this._rasterScale));',
    )
  })
})
