import { useCallback, useState } from 'react'

export function useShellOverlayState(): {
  isCommandCenterOpen: boolean
  isControlCenterOpen: boolean
  isIssueReportOpen: boolean
  isWorkspaceSearchOpen: boolean
  isSpaceArchivesOpen: boolean
  isAddProjectWizardOpen: boolean
  hasBlockingOverlay: boolean
  toggleCommandCenter: () => void
  closeCommandCenter: () => void
  toggleControlCenter: () => void
  closeControlCenter: () => void
  toggleIssueReport: () => void
  closeIssueReport: () => void
  openWorkspaceSearch: () => void
  closeWorkspaceSearch: () => void
  openSpaceArchives: () => void
  closeSpaceArchives: () => void
  openAddProjectWizard: () => void
  closeAddProjectWizard: () => void
  closeTransientOverlays: () => void
} {
  const [isCommandCenterOpen, setIsCommandCenterOpen] = useState(false)
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false)
  const [isIssueReportOpen, setIsIssueReportOpen] = useState(false)
  const [isWorkspaceSearchOpen, setIsWorkspaceSearchOpen] = useState(false)
  const [isSpaceArchivesOpen, setIsSpaceArchivesOpen] = useState(false)
  const [isAddProjectWizardOpen, setIsAddProjectWizardOpen] = useState(false)

  const closeCommandCenter = useCallback((): void => setIsCommandCenterOpen(false), [])
  const closeControlCenter = useCallback((): void => setIsControlCenterOpen(false), [])
  const closeIssueReport = useCallback((): void => setIsIssueReportOpen(false), [])
  const closeWorkspaceSearch = useCallback((): void => setIsWorkspaceSearchOpen(false), [])
  const closeSpaceArchives = useCallback((): void => setIsSpaceArchivesOpen(false), [])
  const closeAddProjectWizard = useCallback((): void => setIsAddProjectWizardOpen(false), [])

  const closeTransientOverlays = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsIssueReportOpen(false)
    setIsAddProjectWizardOpen(false)
  }, [])

  const toggleCommandCenter = useCallback((): void => {
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsIssueReportOpen(false)
    setIsCommandCenterOpen(open => !open)
  }, [])

  const toggleControlCenter = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsIssueReportOpen(false)
    setIsControlCenterOpen(open => !open)
  }, [])

  const toggleIssueReport = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsIssueReportOpen(open => !open)
  }, [])

  const openWorkspaceSearch = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsControlCenterOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsIssueReportOpen(false)
    setIsWorkspaceSearchOpen(true)
  }, [])

  const openSpaceArchives = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsIssueReportOpen(false)
    setIsSpaceArchivesOpen(true)
  }, [])

  const openAddProjectWizard = useCallback((): void => {
    closeTransientOverlays()
    setIsAddProjectWizardOpen(true)
  }, [closeTransientOverlays])

  return {
    isCommandCenterOpen,
    isControlCenterOpen,
    isIssueReportOpen,
    isWorkspaceSearchOpen,
    isSpaceArchivesOpen,
    isAddProjectWizardOpen,
    hasBlockingOverlay:
      isCommandCenterOpen ||
      isControlCenterOpen ||
      isIssueReportOpen ||
      isWorkspaceSearchOpen ||
      isSpaceArchivesOpen ||
      isAddProjectWizardOpen,
    toggleCommandCenter,
    closeCommandCenter,
    toggleControlCenter,
    closeControlCenter,
    toggleIssueReport,
    closeIssueReport,
    openWorkspaceSearch,
    closeWorkspaceSearch,
    openSpaceArchives,
    closeSpaceArchives,
    openAddProjectWizard,
    closeAddProjectWizard,
    closeTransientOverlays,
  }
}
