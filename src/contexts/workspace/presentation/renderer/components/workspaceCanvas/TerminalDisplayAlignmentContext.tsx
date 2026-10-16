import { createContext, useContext, type ReactNode } from 'react'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'

export interface TerminalDisplayAlignmentValue {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
  /** Terminal text sits on the window's reading plate instead of its own background. */
  terminalTransparentBackground: boolean
}

const TerminalDisplayAlignmentContext = createContext<TerminalDisplayAlignmentValue | null>(null)

export function TerminalDisplayAlignmentProvider({
  value,
  children,
}: {
  value: TerminalDisplayAlignmentValue
  children: ReactNode
}) {
  return (
    <TerminalDisplayAlignmentContext.Provider value={value}>
      {children}
    </TerminalDisplayAlignmentContext.Provider>
  )
}

export function useTerminalDisplayAlignment(): TerminalDisplayAlignmentValue {
  const value = useContext(TerminalDisplayAlignmentContext)
  if (!value) {
    throw new Error('Terminal display alignment provider is unavailable.')
  }
  return value
}
