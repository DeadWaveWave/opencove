import type { PixelRect, PixelViewport } from './geometry'
import { pointOnFrame } from './perimeter'

export type PixelSparkKind = 'lod' | 'complete' | 'fail'
const SPECS = {
  lod: { count: 10, speed: 40, life: 260, gravity: 0 },
  complete: { count: 26, speed: 260, life: 700, gravity: 0 },
  fail: { count: 14, speed: 150, life: 560, gravity: 320 },
} as const

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  born: number
  life: number
  size: number
  color: string
  gravity: number
}
export interface PixelSpark {
  x: number
  y: number
  size: number
  color: string
  alpha: number
}

/** World-coordinate particles, owned only by the effects canvas and never persisted. */
export function createPixelSparks(random: () => number = Math.random) {
  let particles: Particle[] = []
  return {
    spawn(kind: PixelSparkKind, rect: PixelRect, color: string, now: number): void {
      const spec = SPECS[kind]
      const cx = rect.x + rect.width / 2,
        cy = rect.y + rect.height / 2
      for (let i = 0; i < spec.count; i++) {
        const { x, y } = pointOnFrame(rect, random() * 2 * (rect.width + rect.height))
        const dx = x - cx,
          dy = y - cy,
          distance = Math.hypot(dx, dy) || 1
        const speed = spec.speed * (0.5 + random())
        particles.push({
          x,
          y,
          vx: (dx / distance) * speed,
          vy: (dy / distance) * speed,
          born: now,
          life: spec.life * (0.7 + random() * 0.6),
          size: 2 + random() * 2.5,
          color,
          gravity: spec.gravity,
        })
      }
      if (particles.length > 1200) {
        particles.splice(0, particles.length - 1200)
      }
    },
    sample(now: number): PixelSpark[] {
      particles = particles.filter(p => now - p.born < p.life)
      return particles.map(p => {
        const age = Math.max(0, now - p.born),
          seconds = age / 1000
        // Tide prototype 1997–2000: integrate exponential drag, independent of frame cadence.
        const distance = (1 - Math.exp(-2.4 * seconds)) / 2.4
        return {
          x: p.x + p.vx * distance,
          y: p.y + p.vy * distance + 0.5 * p.gravity * seconds * seconds,
          size: p.size,
          color: p.color,
          alpha: (1 - age / p.life) ** 1.2,
        }
      })
    },
    clear(): void {
      particles = []
    },
  }
}

export function drawPixelSparks(
  context: CanvasRenderingContext2D,
  sparks: readonly PixelSpark[],
  viewport: PixelViewport,
  dpr: number,
): void {
  const scale = Math.max(0.55, Math.min(1.2, viewport.zoom))
  const snap = (v: number) => Math.round(v * dpr) / dpr
  for (const spark of sparks) {
    const size = spark.size * scale
    context.fillStyle = spark.color
    context.globalAlpha = spark.alpha
    context.fillRect(
      snap(spark.x * viewport.zoom + viewport.x - size / 2),
      snap(spark.y * viewport.zoom + viewport.y - size / 2),
      size,
      size,
    )
  }
  context.globalAlpha = 1
}
