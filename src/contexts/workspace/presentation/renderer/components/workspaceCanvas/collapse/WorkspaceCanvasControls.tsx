import { Controls, ControlButton, useReactFlow, type Node } from '@xyflow/react'
import { Scan } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { useWorkspaceCollapse } from './WorkspaceCollapseContext'
import { fitCanvasPresentation } from './fitCanvasPresentation'
import type { TerminalNodeData } from '../../../types'

export function WorkspaceCanvasControls() {
  const collapse = useWorkspaceCollapse()
  const reactFlow = useReactFlow<Node<TerminalNodeData>>()
  const { t } = useTranslation()
  const hasCollapsedSpace = collapse.spaces.some(space => collapse.collapsedSpaceIds[space.id])
  return (
    <Controls
      className="workspace-canvas__controls"
      showInteractive={false}
      showFitView={!hasCollapsedSpace}
    >
      {hasCollapsedSpace ? (
        <ControlButton
          className="react-flow__controls-fitview"
          title={t('canvasCollapse.fitCanvas')}
          aria-label={t('canvasCollapse.fitCanvas')}
          onClick={() =>
            fitCanvasPresentation(reactFlow, collapse.nodes, collapse.spaces, collapse)
          }
        >
          <Scan aria-hidden="true" />
        </ControlButton>
      ) : null}
    </Controls>
  )
}
