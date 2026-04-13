import { useMemo } from 'react'
import type { BranchMode } from './spaceWorktree.shared'

export function useSpaceWorktreePanelHandlers({
  setError,
  setDeleteBranchOnArchive,
  setForceArchiveConfirmed,
  setSkipArchiveHistory,
  setBranchMode,
  setNewBranchName,
  setStartPoint,
  setExistingBranchName,
  handleSuggestNames,
  handleCreate,
  handleArchive,
}: {
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setDeleteBranchOnArchive: React.Dispatch<React.SetStateAction<boolean>>
  setForceArchiveConfirmed: React.Dispatch<React.SetStateAction<boolean>>
  setSkipArchiveHistory: React.Dispatch<React.SetStateAction<boolean>>
  setBranchMode: React.Dispatch<React.SetStateAction<BranchMode>>
  setNewBranchName: React.Dispatch<React.SetStateAction<string>>
  setStartPoint: React.Dispatch<React.SetStateAction<string>>
  setExistingBranchName: React.Dispatch<React.SetStateAction<string>>
  handleSuggestNames: () => Promise<void>
  handleCreate: () => Promise<void>
  handleArchive: () => Promise<void>
}): {
  onBranchModeChange: (mode: BranchMode) => void
  onNewBranchNameChange: (value: string) => void
  onStartPointChange: (value: string) => void
  onExistingBranchNameChange: (value: string) => void
  onSuggestNames: () => void
  onCreate: () => void
  onDeleteBranchOnArchiveChange: (checked: boolean) => void
  onForceArchiveConfirmedChange: (checked: boolean) => void
  onSkipArchiveHistoryChange: (checked: boolean) => void
  onArchive: () => void
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
      onDeleteBranchOnArchiveChange: (checked: boolean) => {
        setDeleteBranchOnArchive(checked)
        setError(null)
      },
      onForceArchiveConfirmedChange: (checked: boolean) => {
        setForceArchiveConfirmed(checked)
        setError(null)
      },
      onSkipArchiveHistoryChange: (checked: boolean) => {
        setSkipArchiveHistory(checked)
        setError(null)
      },
      onArchive: () => {
        void handleArchive()
      },
    }),
    [
      handleArchive,
      handleCreate,
      handleSuggestNames,
      setBranchMode,
      setDeleteBranchOnArchive,
      setForceArchiveConfirmed,
      setError,
      setExistingBranchName,
      setNewBranchName,
      setSkipArchiveHistory,
      setStartPoint,
    ],
  )
}
