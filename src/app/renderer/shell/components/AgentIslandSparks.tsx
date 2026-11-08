import React from 'react'
import { createIslandSparks, type IslandSparkRect } from '../utils/islandSparks'

/** Room around the flight for the bow and the scatter. */
const MARGIN_PX = 40

export interface AgentIslandSparksHandle {
  /** Sends a burst of sparks from `from` (the pill) into `to` (a card's icon). */
  spawn: (from: IslandSparkRect, to: { x: number; y: number }, colors: readonly string[]) => void
}

type Box = { left: number; top: number; width: number; height: number }

function unite(box: Box | null, from: IslandSparkRect, to: { x: number; y: number }): Box {
  const left = Math.min(from.left, to.x, box?.left ?? Infinity) - MARGIN_PX
  const top = Math.min(from.top, to.y, box?.top ?? Infinity) - MARGIN_PX
  const right =
    Math.max(from.left + from.width, to.x, box ? box.left + box.width : -Infinity) + MARGIN_PX
  const bottom =
    Math.max(from.top + from.height, to.y, box ? box.top + box.height : -Infinity) + MARGIN_PX
  return {
    left: Math.floor(left),
    top: Math.floor(top),
    width: Math.ceil(right - left),
    height: Math.ceil(bottom - top),
  }
}

/**
 * A canvas that exists only while sparks fly: it mounts on a burst, draws one frame per
 * animation frame, and unmounts with the last spark. No canvas and no frame loop otherwise.
 */
export const AgentIslandSparks = React.forwardRef<AgentIslandSparksHandle>(
  function AgentIslandSparks(_props, forwardedRef) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
    const sparksRef = React.useRef(createIslandSparks())
    const frameRef = React.useRef<number | null>(null)
    const boxRef = React.useRef<Box | null>(null)
    const [box, setBox] = React.useState<Box | null>(null)

    const draw = React.useCallback(() => {
      frameRef.current = null
      const now = performance.now()
      const sparks = sparksRef.current
      const current = boxRef.current
      if (!current || sparks.isIdle(now)) {
        boxRef.current = null
        setBox(null)
        return
      }

      const canvas = canvasRef.current
      const context = canvas?.getContext('2d') ?? null
      if (canvas && context) {
        const dpr = window.devicePixelRatio || 1
        const width = Math.round(current.width * dpr)
        const height = Math.round(current.height * dpr)
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, width, height)
        // Snapped to device pixels, so every spark stays a crisp square.
        for (const spark of sparks.sample(now)) {
          const size = Math.max(1, Math.round(spark.size * dpr))
          context.globalAlpha = spark.alpha
          context.fillStyle = spark.color
          context.fillRect(
            Math.round((spark.x - current.left) * dpr - size / 2),
            Math.round((spark.y - current.top) * dpr - size / 2),
            size,
            size,
          )
        }
        context.globalAlpha = 1
      }
      frameRef.current = window.requestAnimationFrame(draw)
    }, [])

    React.useImperativeHandle(
      forwardedRef,
      () => ({
        spawn: (from, to, colors) => {
          sparksRef.current.spawn({ from, to, colors, now: performance.now() })
          const next = unite(boxRef.current, from, to)
          boxRef.current = next
          setBox(next)
          if (frameRef.current === null) {
            frameRef.current = window.requestAnimationFrame(draw)
          }
        },
      }),
      [draw],
    )

    React.useEffect(
      () => () => {
        if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current)
        }
      },
      [],
    )

    if (!box) {
      return null
    }

    return (
      <canvas
        ref={canvasRef}
        className="agent-island-sparks"
        data-testid="agent-island-sparks"
        aria-hidden="true"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      />
    )
  },
)
