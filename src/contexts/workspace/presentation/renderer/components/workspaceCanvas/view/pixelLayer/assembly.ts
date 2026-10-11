import type { PixelNodeFrame } from './geometry'
import { pixelNoise } from './model'
import { buildPixelCreationRim } from './creationRim'

export const PIXEL_ASSEMBLY_MS = 380
export const PIXEL_ASSEMBLY_READY_TIMEOUT_MS = 1200
const MAX_PENDING_ASSEMBLIES = 32
const MAX_VISIBLE_ASSEMBLIES = 8

export interface PixelAssemblyFrame extends PixelNodeFrame {
  age: number
}

export interface PixelAssemblyClock {
  preparedAt: number
  startedAt: number | null
}

export function pixelAssemblyDeadline(
  clock: PixelAssemblyClock,
  durationMs = PIXEL_ASSEMBLY_MS,
): number {
  return clock.startedAt === null
    ? clock.preparedAt + PIXEL_ASSEMBLY_READY_TIMEOUT_MS
    : clock.startedAt + durationMs
}

/** Only explicit local creation events enter this instance-owned, non-persistent timeline. */
export function createPixelAssembly(durationMs = PIXEL_ASSEMBLY_MS) {
  const entries = new Map<string, PixelAssemblyClock & { sessionId: string | null }>()
  const expire = (now: number): void => {
    for (const [id, entry] of entries) {
      if (now >= pixelAssemblyDeadline(entry, durationMs)) {
        entries.delete(id)
      }
    }
  }
  return {
    prepare(nodeId: string, now: number): void {
      expire(now)
      if (!nodeId || !Number.isFinite(now) || entries.has(nodeId)) {
        return
      }
      if (entries.size >= MAX_PENDING_ASSEMBLIES) {
        const oldest = entries.keys().next().value
        if (oldest) {
          entries.delete(oldest)
        }
      }
      entries.set(nodeId, { preparedAt: now, startedAt: null, sessionId: null })
    },
    markReady(nodeId: string, now: number): boolean {
      expire(now)
      const entry = entries.get(nodeId)
      if (!entry || entry.startedAt !== null || !Number.isFinite(now) || now < entry.preparedAt) {
        return false
      }
      entry.startedAt = now
      return true
    },
    sample(nodes: PixelNodeFrame[], now: number): PixelAssemblyFrame[] {
      expire(now)
      const visible = new Map(nodes.map(node => [node.id, node]))
      const frames: PixelAssemblyFrame[] = []
      for (const [id, entry] of entries) {
        const node = visible.get(id)
        if (!node) {
          if (entry.sessionId !== null) {
            entries.delete(id)
          }
          continue
        }
        if (entry.sessionId !== null && entry.sessionId !== node.sessionId) {
          entries.delete(id)
          continue
        }
        entry.sessionId = node.sessionId
        if (entry.startedAt === null) {
          continue
        }
        if (frames.length >= MAX_VISIBLE_ASSEMBLIES) {
          // Overflow stays fully revealed instead of acquiring a delayed curtain later.
          entries.delete(id)
          continue
        }
        frames.push({
          ...node,
          age: (Math.max(0, now - entry.startedAt) * PIXEL_ASSEMBLY_MS) / durationMs,
        })
      }
      return frames
    },
    hasPending(now: number): boolean {
      expire(now)
      return entries.size > 0
    },
    pendingIds(now: number): string[] {
      expire(now)
      return [...entries.keys()]
    },
    reveal(nodeId: string): boolean {
      return entries.delete(nodeId)
    },
    clear(): void {
      entries.clear()
    },
  }
}

type AssemblyPixel = { x: number; y: number; size: number; alpha: number }
export interface PixelAssemblyScene {
  particles: AssemblyPixel[]
  rim: AssemblyPixel[]
}

export interface PixelAssemblyBand {
  top: number
  height: number
  reveal: number
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** A normalized frontier gives every width/zoom the same wall-clock completion time. */
export function buildPixelAssemblyFrontier(frame: PixelAssemblyFrame): PixelAssemblyBand[] {
  const progress = clamp(frame.age / PIXEL_ASSEMBLY_MS)
  const reveal = progress * progress * (3 - 2 * progress)
  const envelope = Math.sin(Math.PI * reveal)
  const positions = [0, 0.17, 0.34, 0.52, 0.71, 0.86, 1]
  const steps = [0, -0.03, 0.02, -0.02, 0.01, 0]
  return steps.map((step, index) => ({
    top: positions[index],
    height: positions[index + 1] - positions[index],
    reveal: clamp(reveal + step * envelope),
  }))
}

/** The foreground contains fragments only. Ahead of the mask frontier the canvas stays transparent. */
export function buildPixelAssemblyScene(frame: PixelAssemblyFrame): PixelAssemblyScene {
  const scene: PixelAssemblyScene = { particles: [], rim: [] }
  if (frame.age < 0 || frame.age >= PIXEL_ASSEMBLY_MS) {
    return scene
  }
  const progress = clamp(frame.age / PIXEL_ASSEMBLY_MS)
  const reveal = progress * progress * (3 - 2 * progress)
  const envelope = Math.sin(Math.PI * progress)
  const seed = [...frame.id].reduce(
    (value, character) => (Math.imul(value, 31) + character.charCodeAt(0)) | 0,
    0,
  )
  const { x, y, width, height } = frame.rect
  const rows = Math.max(1, Math.min(64, Math.ceil(height / 10)))
  const cellHeight = height / rows
  const frontier = buildPixelAssemblyFrontier(frame)
  scene.rim = buildPixelCreationRim(frame.rect, frontier, envelope, seed)

  for (let row = 0; row < rows; row++) {
    const band =
      frontier.find(part => row / rows < part.top + part.height) ?? frontier[frontier.length - 1]
    const frontX = x + band.reveal * width
    const rowY = y + row * cellHeight
    for (let column = 0; column < 6; column++) {
      const noise = pixelNoise(row + seed, column)
      if (noise < 0.18 || envelope <= 0) {
        continue
      }
      const distance = column * 9 + (1 - reveal) * (12 + noise * 36)
      scene.particles.push({
        x: frontX + distance,
        y: rowY + (noise - 0.5) * (1 - reveal) * 45,
        size: (2 + noise * 5) * (1 - reveal * 0.3),
        alpha: envelope * (1 - column / 7) * (0.35 + noise * 0.6),
      })
    }
  }
  return scene
}
