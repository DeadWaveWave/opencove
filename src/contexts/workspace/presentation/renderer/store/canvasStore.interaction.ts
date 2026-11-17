import type { SelectionDraftUiState } from '../components/workspaceCanvas/types'
import type { CanvasSliceWrite } from './canvasStore'

/**
 * What a gesture shows while it runs: UI projection only, never persisted, never synced. The live
 * node overlay, the snap guides and the frame previews join it in the later pull requests of S6.
 */
export interface CanvasInteractionState {
  /** The marquee rectangle; null while no box selection is drawn. */
  readonly selectionDraft: SelectionDraftUiState | null
  /** A session preference, not per-frame state; the provider carries it across a workspace switch. */
  readonly magneticSnappingEnabled: boolean
}

export interface CanvasInteractionCommands {
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

export function createCanvasInteractionCommands(
  write: CanvasSliceWrite<CanvasInteractionState>,
): CanvasInteractionCommands {
  return {
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
