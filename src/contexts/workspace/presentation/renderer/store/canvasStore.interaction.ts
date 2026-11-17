import type { SelectionDraftUiState } from '../components/workspaceCanvas/types'
import type { WorkspaceSpaceRect } from '../types'
import { areLiveNodesEqual, type LiveNodes } from '../utils/canvasLiveNodes'
import { areWorkspaceSnapGuidesEqual, type WorkspaceSnapGuide } from '../utils/workspaceSnap'
import type { CanvasSliceWrite } from './canvasStore'

type FramePreview = ReadonlyMap<string, WorkspaceSpaceRect>

/**
 * What a gesture shows while it runs: UI projection only, never persisted, never synced. The Space
 * drag's frame preview and the live positions of a Space drag join it in the later pull requests
 * of S6.
 */
export interface CanvasInteractionState {
  /**
   * The overlay of a node gesture: an entry for each window the gesture owns, as of the last drag
   * frame, and none for the others. Null while no gesture is live. `applyLiveNodes` turns it and
   * the committed nodes into what React Flow shows.
   */
  readonly liveNodes: LiveNodes | null
  /** The snap guides of a node or Space drag; null while none is shown. */
  readonly snapGuides: WorkspaceSnapGuide[] | null
  /** The Space frames a node drag would produce (a Space-dominant or edge-crossing drop). */
  readonly nodeDragFramePreview: FramePreview | null
  /** The marquee rectangle; null while no box selection is drawn. */
  readonly selectionDraft: SelectionDraftUiState | null
  /** A session preference, not per-frame state; the provider carries it across a workspace switch. */
  readonly magneticSnappingEnabled: boolean
}

export interface CanvasInteractionCommands {
  /** Replaces the overlay (an equal map keeps the stored one and notifies nobody); each frame of a node drag calls it. */
  publishLiveNodes(liveNodes: LiveNodes): void
  /** A no-op, and notifies nobody, when no gesture is live. */
  endLiveNodes(): void
  /** Equal guides (`areWorkspaceSnapGuidesEqual`) keep the stored ones and notify nobody. */
  setSnapGuides(guides: WorkspaceSnapGuide[] | null): void
  /** An equal preview (the same ids, the same rects) keeps the stored one and notifies nobody. */
  setNodeDragFramePreview(preview: FramePreview | null): void
  /** An equal draft (the same five fields) keeps the stored one and notifies nobody. */
  setSelectionDraft(draft: SelectionDraftUiState | null): void
  toggleMagneticSnapping(): void
}

export interface CanvasInteractionInitialState {
  readonly magneticSnappingEnabled?: boolean
}

export function createInitialCanvasInteractionState(
  initial: CanvasInteractionInitialState = {},
): CanvasInteractionState {
  return {
    liveNodes: null,
    snapGuides: null,
    nodeDragFramePreview: null,
    selectionDraft: null,
    magneticSnappingEnabled: initial.magneticSnappingEnabled ?? true,
  }
}

function areSelectionDraftsEqual(
  left: SelectionDraftUiState | null,
  right: SelectionDraftUiState | null,
): boolean {
  if (left === null || right === null) {
    return left === right
  }

  return (
    left.startX === right.startX &&
    left.startY === right.startY &&
    left.currentX === right.currentX &&
    left.currentY === right.currentY &&
    left.phase === right.phase
  )
}

function areSpaceRectsEqual(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function areFramePreviewsEqual(a: FramePreview | null, b: FramePreview | null): boolean {
  if (a === b) {
    return true
  }

  if (!a || !b || a.size !== b.size) {
    return false
  }

  for (const [spaceId, rect] of a.entries()) {
    const other = b.get(spaceId)
    if (!other || !areSpaceRectsEqual(rect, other)) {
      return false
    }
  }

  return true
}

export function createCanvasInteractionCommands(
  write: CanvasSliceWrite<CanvasInteractionState>,
): CanvasInteractionCommands {
  return {
    publishLiveNodes: liveNodes =>
      write(interaction =>
        areLiveNodesEqual(interaction.liveNodes, liveNodes)
          ? interaction
          : { ...interaction, liveNodes },
      ),
    endLiveNodes: () =>
      write(interaction =>
        interaction.liveNodes === null ? interaction : { ...interaction, liveNodes: null },
      ),
    setSnapGuides: guides =>
      write(interaction =>
        areWorkspaceSnapGuidesEqual(interaction.snapGuides, guides)
          ? interaction
          : { ...interaction, snapGuides: guides },
      ),
    setNodeDragFramePreview: preview =>
      write(interaction =>
        areFramePreviewsEqual(interaction.nodeDragFramePreview, preview)
          ? interaction
          : { ...interaction, nodeDragFramePreview: preview },
      ),
    setSelectionDraft: draft =>
      write(interaction =>
        areSelectionDraftsEqual(interaction.selectionDraft, draft)
          ? interaction
          : { ...interaction, selectionDraft: draft },
      ),
    toggleMagneticSnapping: () =>
      write(interaction => ({
        ...interaction,
        magneticSnappingEnabled: !interaction.magneticSnappingEnabled,
      })),
  }
}
