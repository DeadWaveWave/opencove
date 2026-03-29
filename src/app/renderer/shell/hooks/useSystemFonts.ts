import { useState, useEffect } from 'react'
import type { SystemFontInfo } from '@shared/contracts/dto'

type SystemFontsState = {
  fonts: SystemFontInfo[]
  isLoading: boolean
}

const initialState: SystemFontsState = {
  fonts: [],
  isLoading: false,
}

let cachedFonts: SystemFontInfo[] | null = null

export function useSystemFonts(): SystemFontsState {
  const [state, setState] = useState<SystemFontsState>(() => {
    if (cachedFonts !== null) {
      return { fonts: cachedFonts, isLoading: false }
    }
    return initialState
  })

  useEffect(() => {
    if (cachedFonts !== null) {
      setState({ fonts: cachedFonts, isLoading: false })
      return
    }

    if (!window.opencoveApi?.system) {
      return
    }

    setState(prev => ({ ...prev, isLoading: true }))

    void window.opencoveApi.system
      .listFonts()
      .then(result => {
        cachedFonts = result.fonts
        setState({ fonts: result.fonts, isLoading: false })
      })
      .catch(() => {
        setState({ fonts: [], isLoading: false })
      })
  }, [])

  return state
}
