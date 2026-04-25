import { useMemo } from 'react'
import type { BranchMode } from './spaceWorktree.shared'

export function useSpaceWorktreePanelHandlers({
  setError,
  setDeleteWorktreeOnArchive,
  setDeleteBranchOnArchive,
  setForceArchiveConfirmed,
  setBranchMode,
  setNewBranchName,
  setStartPoint,
  setExistingBranchName,
  handleSuggestNames,
  handleCreate,
  handleArchive,
}: {
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setDeleteWorktreeOnArchive: React.Dispatch<React.SetStateAction<boolean>>
  setDeleteBranchOnArchive: React.Dispatch<React.SetStateAction<boolean>>
  setForceArchiveConfirmed: React.Dispatch<React.SetStateAction<boolean>>
  setBranchMode: React.Dispatch<React.SetStateAction<BranchMode>>
  setNewBranchName: React.Dispatch<React.SetStateAction<string>>
  setStartPoint: React.Dispatch<React.SetStateAction<string>>
  setExistingBranchName: React.Dispatch<React.SetStateAction<string>>
  handleSuggestNames: () => Promise<void>
  handleCreate: () => Promise<void>
  handleArchive: (saveArchiveRecord: boolean) => Promise<void>
}): {
  onBranchModeChange: (mode: BranchMode) => void
  onNewBranchNameChange: (value: string) => void
  onStartPointChange: (value: string) => void
  onExistingBranchNameChange: (value: string) => void
  onSuggestNames: () => void
  onCreate: () => void
  onDeleteWorktreeOnArchiveChange: (checked: boolean) => void
  onDeleteBranchOnArchiveChange: (checked: boolean) => void
  onForceArchiveConfirmedChange: (checked: boolean) => void
  onArchive: () => void
  onCloseOnly: () => void
} {
  return useMemo(
    () => ({
      onBranchModeChange: (mode: BranchMode) => {
        setBranchMode(mode)
        setError(null)
      },
      onNewBranchNameChange: (value: string) => {
        setNewBranchName(value)
        setError(null)
      },
      onStartPointChange: (value: string) => {
        setStartPoint(value)
        setError(null)
      },
      onExistingBranchNameChange: (value: string) => {
        setExistingBranchName(value)
        setError(null)
      },
      onSuggestNames: () => {
        void handleSuggestNames()
      },
      onCreate: () => {
        void handleCreate()
      },
      onDeleteWorktreeOnArchiveChange: (checked: boolean) => {
        setDeleteWorktreeOnArchive(checked)
        setError(null)
      },
      onDeleteBranchOnArchiveChange: (checked: boolean) => {
        setDeleteBranchOnArchive(checked)
        setError(null)
      },
      onForceArchiveConfirmedChange: (checked: boolean) => {
        setForceArchiveConfirmed(checked)
        setError(null)
      },
      onArchive: () => {
        void handleArchive(true)
      },
      onCloseOnly: () => {
        void handleArchive(false)
      },
    }),
    [
      handleArchive,
      handleCreate,
      handleSuggestNames,
      setBranchMode,
      setDeleteWorktreeOnArchive,
      setDeleteBranchOnArchive,
      setForceArchiveConfirmed,
      setError,
      setExistingBranchName,
      setNewBranchName,
      setStartPoint,
    ],
  )
}
