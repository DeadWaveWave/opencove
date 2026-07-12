import { useCallback, type Dispatch, type SetStateAction } from 'react'

interface AddProjectWizardAnchor {
  x: number
  y: number
}

export function useAddProjectRequest(
  openAddProjectWizard: (anchor?: AddProjectWizardAnchor) => void,
  setIsFocusNodeTargetZoomPreviewing: Dispatch<SetStateAction<boolean>>,
): (anchor?: AddProjectWizardAnchor) => void {
  return useCallback(
    (anchor?: AddProjectWizardAnchor): void => {
      setIsFocusNodeTargetZoomPreviewing(false)
      openAddProjectWizard(anchor)
    },
    [openAddProjectWizard, setIsFocusNodeTargetZoomPreviewing],
  )
}
