import type { PixelNodeFrame, PixelRect } from './geometry'
import { pixelNoise } from './model'

export const PIXEL_ASSEMBLY_MS = 720
const MAX_PENDING_ASSEMBLIES = 32
const MAX_VISIBLE_ASSEMBLIES = 8

export interface PixelAssemblyFrame extends PixelNodeFrame {
  age: number
}

/** Only explicit local creation events enter this instance-owned, non-persistent timeline. */
export function createPixelAssembly() {
  const entries = new Map<string, { createdAt: number; sessionId: string | null }>()
  const expire = (now: number): void => {
    for (const [id, entry] of entries) {
      if (now - entry.createdAt >= PIXEL_ASSEMBLY_MS) {
        entries.delete(id)
      }
    }
  }
  return {
    announce(nodeId: string, now: number): void {
      expire(now)
      if (!nodeId || entries.has(nodeId)) {
        return
      }
      if (entries.size >= MAX_PENDING_ASSEMBLIES) {
        const oldest = entries.keys().next().value
        if (oldest) {
          entries.delete(oldest)
        }
      }
      entries.set(nodeId, { createdAt: now, sessionId: null })
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
        if (frames.length >= MAX_VISIBLE_ASSEMBLIES) {
          // Overflow stays fully revealed instead of acquiring a delayed curtain later.
          entries.delete(id)
          continue
        }
        entry.sessionId = node.sessionId
        frames.push({ ...node, age: Math.max(0, now - entry.createdAt) })
      }
      return frames
    },
    hasPending(now: number): boolean {
      expire(now)
      return entries.size > 0
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
  veil: PixelRect[]
  matrix: AssemblyPixel[]
  particles: AssemblyPixel[]
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** The canvas veil reveals the already-mounted node; it never clips or resizes that node. */
export function buildPixelAssemblyScene(frame: PixelAssemblyFrame): PixelAssemblyScene {
  const scene: PixelAssemblyScene = { veil: [], matrix: [], particles: [] }
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
  const columns = Math.max(1, Math.min(80, Math.ceil(width / 8)))
  const rows = Math.max(1, Math.min(64, Math.ceil(height / 10)))
  const cellWidth = width / columns
  const cellHeight = height / rows

  for (let row = 0; row < rows; row++) {
    // A stable stepped front: its irregular edge contracts as the reveal completes.
    const rowReveal = clamp(reveal + (pixelNoise(row, seed) - 0.5) * envelope * 0.07)
    const revealedColumns = Math.floor(rowReveal * columns)
    const frontX = x + revealedColumns * cellWidth
    const rowY = y + row * cellHeight
    scene.veil.push({ x: frontX, y: rowY, width: x + width - frontX, height: cellHeight })
    if (row % 2 === 0) {
      for (let column = revealedColumns; column < columns; column += 3) {
        const noise = pixelNoise(column + seed, row)
        scene.matrix.push({
          x: x + column * cellWidth + cellWidth * 0.3,
          y: rowY + cellHeight * 0.3,
          size: 1.5 + noise * 2,
          alpha: 0.07 + noise * 0.11,
        })
      }
    }
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
