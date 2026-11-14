import { useEffect, useState } from 'react'
import type { WorkspacePathOpener } from '@shared/contracts/dto'
import type { SpaceActionMenuState } from '../types'

/** Loads the path openers each time the Space action menu opens; only that menu shows them. */
export function useSpacePathOpeners(menu: SpaceActionMenuState | null): WorkspacePathOpener[] {
  const [openers, setOpeners] = useState<WorkspacePathOpener[]>([])

  useEffect(() => {
    if (menu === null) {
      return
    }

    let active = true
    setOpeners(previous => (previous.length === 0 ? previous : []))
    const listPathOpeners = window.opencoveApi?.workspace?.listPathOpeners
    if (typeof listPathOpeners === 'function') {
      void listPathOpeners()
        .then(result => {
          if (active) {
            setOpeners(result.openers)
          }
        })
        .catch(() => {
          if (active) {
            setOpeners(previous => (previous.length === 0 ? previous : []))
          }
        })
    }

    return () => {
      active = false
    }
  }, [menu])

  return openers
}
