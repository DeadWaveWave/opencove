import { useMemo, type ComponentProps } from 'react'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import { TerminalDisplayAlignmentProvider } from './TerminalDisplayAlignmentContext'
import { WorkspaceCanvasView } from './WorkspaceCanvasView'

export function TerminalDisplayAlignedWorkspaceCanvasView({
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayCalibration,
  ...viewProps
}: ComponentProps<typeof WorkspaceCanvasView> & {
  terminalFontSize: number
  terminalFontFamily: string | null
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
}) {
  const value = useMemo(
    () => ({ terminalFontSize, terminalFontFamily, terminalDisplayCalibration }),
    [terminalDisplayCalibration, terminalFontFamily, terminalFontSize],
  )
  return (
    <TerminalDisplayAlignmentProvider value={value}>
      <WorkspaceCanvasView {...viewProps} />
    </TerminalDisplayAlignmentProvider>
  )
}
