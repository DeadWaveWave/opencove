import { useCallback, useState } from 'react'

export function useShellOverlayState(): {
  isCommandCenterOpen: boolean
  isControlCenterOpen: boolean
  isPerformanceMonitorOpen: boolean
  isIssueReportOpen: boolean
  isWorkspaceSearchOpen: boolean
  isSpaceArchivesOpen: boolean
  isAddProjectWizardOpen: boolean
  addProjectWizardAnchor: { x: number; y: number }
  hasBlockingOverlay: boolean
  toggleCommandCenter: () => void
  closeCommandCenter: () => void
  toggleControlCenter: () => void
  closeControlCenter: () => void
  togglePerformanceMonitor: () => void
  closePerformanceMonitor: () => void
  toggleIssueReport: () => void
  closeIssueReport: () => void
  openWorkspaceSearch: () => void
  closeWorkspaceSearch: () => void
  openSpaceArchives: () => void
  closeSpaceArchives: () => void
  openAddProjectWizard: (anchor?: { x: number; y: number }) => void
  closeAddProjectWizard: () => void
  closeTransientOverlays: () => void
} {
  const [isCommandCenterOpen, setIsCommandCenterOpen] = useState(false)
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false)
  const [isPerformanceMonitorOpen, setIsPerformanceMonitorOpen] = useState(false)
  const [isIssueReportOpen, setIsIssueReportOpen] = useState(false)
  const [isWorkspaceSearchOpen, setIsWorkspaceSearchOpen] = useState(false)
  const [isSpaceArchivesOpen, setIsSpaceArchivesOpen] = useState(false)
  const [isAddProjectWizardOpen, setIsAddProjectWizardOpen] = useState(false)
  const [addProjectWizardAnchor, setAddProjectWizardAnchor] = useState({ x: 24, y: 64 })

  const closeCommandCenter = useCallback((): void => setIsCommandCenterOpen(false), [])
  const closeControlCenter = useCallback((): void => setIsControlCenterOpen(false), [])
  const closePerformanceMonitor = useCallback((): void => setIsPerformanceMonitorOpen(false), [])
  const closeIssueReport = useCallback((): void => setIsIssueReportOpen(false), [])
  const closeWorkspaceSearch = useCallback((): void => setIsWorkspaceSearchOpen(false), [])
  const closeSpaceArchives = useCallback((): void => setIsSpaceArchivesOpen(false), [])
  const closeAddProjectWizard = useCallback((): void => setIsAddProjectWizardOpen(false), [])

  const closeTransientOverlays = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsPerformanceMonitorOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsIssueReportOpen(false)
    setIsAddProjectWizardOpen(false)
  }, [])

  const toggleCommandCenter = useCallback((): void => {
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsPerformanceMonitorOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsIssueReportOpen(false)
    setIsCommandCenterOpen(open => !open)
  }, [])

  const toggleControlCenter = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsPerformanceMonitorOpen(false)
    setIsIssueReportOpen(false)
    setIsControlCenterOpen(open => !open)
  }, [])

  const togglePerformanceMonitor = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsIssueReportOpen(false)
    setIsPerformanceMonitorOpen(open => !open)
  }, [])

  const toggleIssueReport = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsPerformanceMonitorOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsIssueReportOpen(open => !open)
  }, [])

  const openWorkspaceSearch = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsControlCenterOpen(false)
    setIsPerformanceMonitorOpen(false)
    setIsSpaceArchivesOpen(false)
    setIsIssueReportOpen(false)
    setIsWorkspaceSearchOpen(true)
  }, [])

  const openSpaceArchives = useCallback((): void => {
    setIsCommandCenterOpen(false)
    setIsWorkspaceSearchOpen(false)
    setIsControlCenterOpen(false)
    setIsPerformanceMonitorOpen(false)
    setIsIssueReportOpen(false)
    setIsSpaceArchivesOpen(true)
  }, [])

  const openAddProjectWizard = useCallback(
    (anchor?: { x: number; y: number }): void => {
      closeTransientOverlays()
      if (anchor) {
        setAddProjectWizardAnchor(anchor)
      }
      setIsAddProjectWizardOpen(true)
    },
    [closeTransientOverlays],
  )

  return {
    isCommandCenterOpen,
    isControlCenterOpen,
    isPerformanceMonitorOpen,
    isIssueReportOpen,
    isWorkspaceSearchOpen,
    isSpaceArchivesOpen,
    isAddProjectWizardOpen,
    addProjectWizardAnchor,
    hasBlockingOverlay:
      isCommandCenterOpen ||
      isControlCenterOpen ||
      isIssueReportOpen ||
      isWorkspaceSearchOpen ||
      isSpaceArchivesOpen,
    toggleCommandCenter,
    closeCommandCenter,
    toggleControlCenter,
    closeControlCenter,
    togglePerformanceMonitor,
    closePerformanceMonitor,
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
