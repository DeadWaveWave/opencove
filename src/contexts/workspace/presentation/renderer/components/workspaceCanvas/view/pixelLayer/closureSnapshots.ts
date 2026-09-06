import type { PixelNodeFrame, PixelViewport } from './geometry'

const HANDOFF_MS = 160
const MAX_SNAPSHOTS = 256

type Snapshot = { world: PixelNodeFrame; missingAt: number | null }

/** A bounded geometric handoff across the synchronous node commit. It never infers a close. */
export function createPixelClosureSnapshots() {
  const snapshots = new Map<string, Snapshot>()
  const expire = (now: number) => {
    for (const [id, snapshot] of snapshots) {
      if (snapshot.missingAt !== null && now - snapshot.missingAt >= HANDOFF_MS) {
        snapshots.delete(id)
      }
    }
  }

  return {
    capture(
      frames: PixelNodeFrame[],
      viewport: PixelViewport,
      now: number,
      presentNodeIds?: ReadonlySet<string>,
    ): void {
      expire(now)
      if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
        snapshots.clear()
        return
      }
      const visibleIds = new Set(frames.map(frame => frame.id))
      for (const [id, snapshot] of snapshots) {
        if (!visibleIds.has(id) && presentNodeIds?.has(id)) {
          // Filtering/hiding an existing node is not the commit gap of a removed node.
          snapshots.delete(id)
        } else if (!visibleIds.has(id) && snapshot.missingAt === null) {
          snapshot.missingAt = now
        }
      }
      for (const frame of frames) {
        const { rect } = frame
        snapshots.delete(frame.id)
        snapshots.set(frame.id, {
          world: {
            ...frame,
            rect: {
              x: (rect.x - viewport.x) / viewport.zoom,
              y: (rect.y - viewport.y) / viewport.zoom,
              width: rect.width / viewport.zoom,
              height: rect.height / viewport.zoom,
            },
          },
          missingAt: null,
        })
        if (snapshots.size > MAX_SNAPSHOTS) {
          const oldest = snapshots.keys().next().value
          if (oldest !== undefined) {
            snapshots.delete(oldest)
          }
        }
      }
    },
    take(nodeId: string, viewport: PixelViewport, now: number): PixelNodeFrame | null {
      expire(now)
      const snapshot = snapshots.get(nodeId)
      snapshots.delete(nodeId)
      if (!snapshot) {
        return null
      }
      const { world } = snapshot
      const rect = {
        x: world.rect.x * viewport.zoom + viewport.x,
        y: world.rect.y * viewport.zoom + viewport.y,
        width: world.rect.width * viewport.zoom,
        height: world.rect.height * viewport.zoom,
      }
      if (
        rect.x + rect.width < 0 ||
        rect.y + rect.height < 0 ||
        rect.x > viewport.width ||
        rect.y > viewport.height
      ) {
        return null
      }
      return { ...world, rect }
    },
    clear(): void {
      snapshots.clear()
    },
  }
}
