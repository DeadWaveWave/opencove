import { existsSync } from 'fs'
import { resolve } from 'path'
import type { NativeImage } from 'electron'

// Packaged macOS builds take their Dock icon from the bundle's icon.icns; only source and test
// launches set build/icon.png (2048 px) at runtime. The Dock draws at most 128 pt (256 px on
// Retina), while AppKit's cost scales with pixels: ~190 ms per launch at 2048 px, ~23 ms at 512.
export const DOCK_ICON_MAX_WIDTH_PX = 512

function resolveIconCandidates(baseDir: string, platform: NodeJS.Platform): string[] {
  const rootBuildDir = resolve(baseDir, '../../build')

  if (platform === 'win32') {
    return [resolve(rootBuildDir, 'icon.ico'), resolve(rootBuildDir, 'icon.png')]
  }

  return [resolve(rootBuildDir, 'icon.png')]
}

export function resolveRuntimeIconPath(
  baseDir: string = __dirname,
  platform: NodeJS.Platform = process.platform,
): string | null {
  return resolveIconCandidates(baseDir, platform).find(candidate => existsSync(candidate)) ?? null
}

export function boundDockIconImage(image: NativeImage): NativeImage {
  return image.getSize().width > DOCK_ICON_MAX_WIDTH_PX
    ? image.resize({ width: DOCK_ICON_MAX_WIDTH_PX, quality: 'best' })
    : image
}
