import { useEffect } from 'react'
import type { ProjectContextMenuState } from '../types'

export function useProjectContextMenuDismiss({
  projectContextMenu,
  setProjectContextMenu,
}: {
  projectContextMenu: ProjectContextMenuState | null
  setProjectContextMenu: React.Dispatch<React.SetStateAction<ProjectContextMenuState | null>>
}): void {
  useEffect(() => {
    if (!projectContextMenu) {
      return
    }

    const closeMenu = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('.workspace-context-menu')) {
        return
      }

      setProjectContextMenu(null)
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setProjectContextMenu(null)
      }
    }

    window.addEventListener('pointerdown', closeMenu, true)
    window.addEventListener('mousedown', closeMenu, true)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('pointerdown', closeMenu, true)
      window.removeEventListener('mousedown', closeMenu, true)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [projectContextMenu, setProjectContextMenu])
}
