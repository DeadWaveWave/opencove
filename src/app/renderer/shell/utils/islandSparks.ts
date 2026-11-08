/**
 * The sparks that fly from the agent pill into a new card's icon (docs/ui/AGENT_ISLAND.md). They
 * move on the canvas sparks' drag (`pixelLayer/sparks.ts`) and fade as (1 - t)^1.2, but each
 * one lands: its drag is scaled so it reaches the icon as its life ends, along a slight bow.
 */
export const ISLAND_SPARK_COUNT = 18

/** The whole burst leaves the pill within this window. */
const STAGGER_MS = 140
const LIFE_MS = 560
const LIFE_SPREAD_MS = 200
const BOW_PX = 28
const SCATTER_PX = 4
const DRAG = 2.4

export interface IslandSparkRect {
  left: number
  top: number
  width: number
  height: number
}

export interface IslandSpark {
  x: number
  y: number
  /** Whole pixels, so a spark stays a crisp square. */
  size: number
  color: string
  alpha: number
}

interface Particle {
  fromX: number
  fromY: number
  toX: number
  toY: number
  bow: number
  born: number
  life: number
  size: number
  color: string
}

/** Distance travelled under exponential drag after `seconds`, per unit of launch speed. */
function drag(seconds: number): number {
  return (1 - Math.exp(-DRAG * seconds)) / DRAG
}

export function createIslandSparks(random: () => number = Math.random) {
  let particles: Particle[] = []
  let idleAt = 0

  return {
    spawn({
      from,
      to,
      colors,
      now,
    }: {
      from: IslandSparkRect
      to: { x: number; y: number }
      colors: readonly string[]
      now: number
    }): void {
      for (let index = 0; index < ISLAND_SPARK_COUNT; index += 1) {
        const born = now + random() * STAGGER_MS
        const life = LIFE_MS + random() * LIFE_SPREAD_MS
        particles.push({
          fromX: from.left + random() * from.width,
          fromY: from.top + random() * from.height,
          toX: to.x + (random() - 0.5) * 2 * SCATTER_PX,
          toY: to.y + (random() - 0.5) * 2 * SCATTER_PX,
          bow: (random() - 0.5) * 2 * BOW_PX,
          born,
          life,
          size: 3 + Math.floor(random() * 2),
          color: colors[index % colors.length] ?? 'currentColor',
        })
        idleAt = Math.max(idleAt, born + life)
      }
    },
    sample(now: number): IslandSpark[] {
      particles = particles.filter(particle => now - particle.born < particle.life)
      const sparks: IslandSpark[] = []
      for (const particle of particles) {
        const age = now - particle.born
        if (age < 0) {
          continue
        }
        const progress = drag(age / 1000) / drag(particle.life / 1000)
        const dx = particle.toX - particle.fromX
        const dy = particle.toY - particle.fromY
        const length = Math.hypot(dx, dy) || 1
        const bow = particle.bow * Math.sin(Math.PI * progress)
        sparks.push({
          x: particle.fromX + dx * progress - (dy / length) * bow,
          y: particle.fromY + dy * progress + (dx / length) * bow,
          size: particle.size,
          color: particle.color,
          alpha: (1 - age / particle.life) ** 1.2,
        })
      }
      return sparks
    },
    isIdle(now: number): boolean {
      return now >= idleAt
    },
  }
}
