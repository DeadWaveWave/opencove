import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeImage } from 'electron'
import {
  DOCK_ICON_MAX_WIDTH_PX,
  boundDockIconImage,
  resolveRuntimeIconPath,
} from '../../../src/app/main/runtimeIcon'

describe('resolveRuntimeIconPath', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prefers the Windows .ico when both icon files exist', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'opencove-runtime-icon-'))
    tempDirs.push(rootDir)

    const appMainDir = join(rootDir, 'app', 'main')
    const buildDir = join(rootDir, 'build')
    mkdirSync(appMainDir, { recursive: true })
    mkdirSync(buildDir, { recursive: true })
    writeFileSync(join(buildDir, 'icon.png'), 'png')
    writeFileSync(join(buildDir, 'icon.ico'), 'ico')

    expect(resolveRuntimeIconPath(appMainDir, 'win32')).toBe(join(buildDir, 'icon.ico'))
  })

  it('falls back to the png on Windows when the ico is missing', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'opencove-runtime-icon-'))
    tempDirs.push(rootDir)

    const appMainDir = join(rootDir, 'app', 'main')
    const buildDir = join(rootDir, 'build')
    mkdirSync(appMainDir, { recursive: true })
    mkdirSync(buildDir, { recursive: true })
    writeFileSync(join(buildDir, 'icon.png'), 'png')

    expect(resolveRuntimeIconPath(appMainDir, 'win32')).toBe(join(buildDir, 'icon.png'))
  })

  it('uses the png on non-Windows platforms', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'opencove-runtime-icon-'))
    tempDirs.push(rootDir)

    const appMainDir = join(rootDir, 'app', 'main')
    const buildDir = join(rootDir, 'build')
    mkdirSync(appMainDir, { recursive: true })
    mkdirSync(buildDir, { recursive: true })
    writeFileSync(join(buildDir, 'icon.png'), 'png')
    writeFileSync(join(buildDir, 'icon.ico'), 'ico')

    expect(resolveRuntimeIconPath(appMainDir, 'darwin')).toBe(join(buildDir, 'icon.png'))
  })
})

describe('boundDockIconImage', () => {
  function createImage(width: number, height: number) {
    const resized = { label: 'resized' } as unknown as NativeImage
    const image = {
      getSize: () => ({ width, height }),
      resize: vi.fn(() => resized),
    }
    return { image: image as unknown as NativeImage, resize: image.resize, resized }
  }

  it('downsizes a larger source to the Dock bound with best quality and its aspect ratio', () => {
    const { image, resize, resized } = createImage(2048, 2048)

    expect(boundDockIconImage(image)).toBe(resized)
    expect(resize).toHaveBeenCalledWith({ width: DOCK_ICON_MAX_WIDTH_PX, quality: 'best' })
  })

  it('keeps a source that already fits the Dock bound', () => {
    const { image, resize } = createImage(DOCK_ICON_MAX_WIDTH_PX, DOCK_ICON_MAX_WIDTH_PX)

    expect(boundDockIconImage(image)).toBe(image)
    expect(resize).not.toHaveBeenCalled()
  })
})
