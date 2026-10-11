import type { PixelNodeFrame, PixelRect, PixelViewport } from './geometry'
import { pixelNoise } from './model'

export const PIXEL_BURST_MS = 420
const MAX_BURSTS = 8
const SNAP_MS = 90

export interface PixelBurstFrame extends PixelNodeFrame {
  age: number
  zoomRatio: number
  sourceSize: { width: number; height: number }
}

interface BurstEntry {
  id: string
  sessionId: string
  worldRect: PixelRect
  sourceSize: { width: number; height: number }
  initialZoom: number
  closedAt: number
}

function validViewport(viewport: PixelViewport): boolean {
  return Object.values(viewport).every(Number.isFinite) && viewport.zoom > 0
}

/** Closing owns node removal. This timeline retains only copied geometry for its brief afterimage. */
export function createPixelBurst(durationMs = PIXEL_BURST_MS) {
  const entries = new Map<string, BurstEntry>()
  const expire = (now: number) => {
    for (const [id, entry] of entries) {
      if (now - entry.closedAt >= durationMs) {
        entries.delete(id)
      }
    }
  }
  return {
    announce(frame: PixelNodeFrame, viewport: PixelViewport, now: number): void {
      expire(now)
      if (
        !frame.id ||
        entries.has(frame.id) ||
        !Number.isFinite(now) ||
        !validViewport(viewport) ||
        !Object.values(frame.rect).every(Number.isFinite) ||
        frame.rect.width <= 0 ||
        frame.rect.height <= 0
      ) {
        return
      }
      const { x, y, width, height } = frame.rect
      if (entries.size >= MAX_BURSTS) {
        const oldest = entries.keys().next().value
        if (oldest) {
          entries.delete(oldest)
        }
      }
      entries.set(frame.id, {
        id: frame.id,
        sessionId: frame.sessionId,
        worldRect: {
          x: (x - viewport.x) / viewport.zoom,
          y: (y - viewport.y) / viewport.zoom,
          width: width / viewport.zoom,
          height: height / viewport.zoom,
        },
        sourceSize: { width, height },
        initialZoom: viewport.zoom,
        closedAt: now,
      })
    },
    sample(viewport: PixelViewport, now: number): PixelBurstFrame[] {
      expire(now)
      if (!validViewport(viewport) || viewport.width <= 0 || viewport.height <= 0) {
        return []
      }
      const frames: PixelBurstFrame[] = []
      for (const entry of entries.values()) {
        const zoomRatio = viewport.zoom / entry.initialZoom
        const rect = {
          x: entry.worldRect.x * viewport.zoom + viewport.x,
          y: entry.worldRect.y * viewport.zoom + viewport.y,
          width: entry.worldRect.width * viewport.zoom,
          height: entry.worldRect.height * viewport.zoom,
        }
        const margin = 128 * zoomRatio
        if (
          rect.x + rect.width < -margin ||
          rect.y + rect.height < -margin ||
          rect.x > viewport.width + margin ||
          rect.y > viewport.height + margin
        ) {
          continue
        }
        frames.push({
          id: entry.id,
          sessionId: entry.sessionId,
          rect,
          sourceSize: { ...entry.sourceSize },
          zoomRatio,
          age: (Math.max(0, now - entry.closedAt) * PIXEL_BURST_MS) / durationMs,
        })
      }
      return frames
    },
    hasPending(now: number): boolean {
      expire(now)
      return entries.size > 0
    },
    clear(): void {
      entries.clear()
    },
  }
}

export interface PixelBurstPixel {
  x: number
  y: number
  size: number
  alpha: number
}
export interface PixelBurstScene {
  particles: PixelBurstPixel[]
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => value * value * (3 - 2 * value)

/** A dense square surface snaps outward first, then drifts and fades. No node or text is sampled. */
export function buildPixelBurstScene(frame: PixelBurstFrame): PixelBurstScene {
  const scene: PixelBurstScene = { particles: [] }
  if (frame.age < 0 || frame.age >= PIXEL_BURST_MS) {
    return scene
  }
  const snap = 1 - (1 - clamp(frame.age / SNAP_MS)) ** 3
  const drift = clamp((frame.age - SNAP_MS) / (PIXEL_BURST_MS - SNAP_MS))
  const fade = 1 - smooth(drift)
  const seed = [...frame.id].reduce(
    (value, character) => (Math.imul(value, 31) + character.charCodeAt(0)) | 0,
    0,
  )
  const { x, y, width, height } = frame.rect
  const scale = frame.zoomRatio
  const centerX = x + width / 2
  const centerY = y + height / 2
  const addParticle = (u: number, v: number, index: number, edge: boolean) => {
    const noise = pixelNoise(index, seed)
    const startX = x + u * width
    const startY = y + v * height
    const dx = startX - centerX
    const dy = startY - centerY
    const length = Math.hypot(dx, dy)
    const fallbackX = noise - 0.5
    const fallbackY = pixelNoise(index, seed + 1) - 0.5
    const fallbackLength = Math.hypot(fallbackX, fallbackY) || 1
    const directionX = length > 0.001 ? dx / length : fallbackX / fallbackLength
    const directionY = length > 0.001 ? dy / length : fallbackY / fallbackLength
    const distance = (snap * (26 + noise * 54) + drift * (12 + noise * 22)) * scale
    const tangent = (noise - 0.5) * drift * 18 * scale
    scene.particles.push({
      x: startX + directionX * distance - directionY * tangent,
      y: startY + directionY * distance + directionX * tangent + drift * drift * 14 * scale,
      size: (edge ? 3 + noise * 5 : 2.5 + noise * 5.5) * (1 - drift * 0.55) * scale,
      alpha: (edge ? 0.92 : 0.68 + noise * 0.28) * fade,
    })
  }
  const columns = Math.max(4, Math.min(16, Math.ceil(frame.sourceSize.width / 26)))
  const rows = Math.max(3, Math.min(10, Math.ceil(frame.sourceSize.height / 26)))
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column
      const jitter = pixelNoise(index, seed + 1) - 0.5
      addParticle(
        (column + 0.5 + jitter * 0.65) / columns,
        (row + 0.5 - jitter * 0.65) / rows,
        index,
        false,
      )
    }
  }
  const horizontal = Math.max(8, Math.min(24, Math.ceil(frame.sourceSize.width / 18)))
  const vertical = Math.max(6, Math.min(24, Math.ceil(frame.sourceSize.height / 18)))
  let edgeIndex = columns * rows
  for (let index = 0; index < horizontal; index++) {
    addParticle((index + 0.5) / horizontal, 0, edgeIndex++, true)
    addParticle((index + 0.5) / horizontal, 1, edgeIndex++, true)
  }
  for (let index = 0; index < vertical; index++) {
    addParticle(0, (index + 0.5) / vertical, edgeIndex++, true)
    addParticle(1, (index + 0.5) / vertical, edgeIndex++, true)
  }
  return scene
}
