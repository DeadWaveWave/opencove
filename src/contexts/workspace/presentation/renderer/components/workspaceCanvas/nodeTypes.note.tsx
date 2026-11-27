import type { ReactElement } from 'react'
import { NoteNode } from '../NoteNode'
import type { TerminalNodeData } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import { useCanvasNodeCommands } from './nodeTypes.context'
import { useNodePosition } from './nodePosition'

export function WorkspaceCanvasNoteNodeType({
  data,
  id,
  onShowMessage,
}: {
  data: TerminalNodeData
  id: string
  onShowMessage?: (message: string, tone?: 'info' | 'warning' | 'error') => void
}): ReactElement | null {
  const { window: windowCommands, note } = useCanvasNodeCommands()
  const nodePosition = useNodePosition(id)
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null

  if (!data.note) {
    return null
  }

  return (
    <NoteNode
      title={data.title}
      text={data.note.text}
      labelColor={labelColor}
      labelColorOverride={data.labelColorOverride ?? null}
      position={nodePosition}
      width={data.width}
      height={data.height}
      onShowMessage={onShowMessage}
      onClose={() => {
        void windowCommands.close(id)
      }}
      onResize={frame => windowCommands.resize(id, frame)}
      onTextChange={text => {
        note.updateText(id, text)
      }}
      onTitleChange={title => {
        note.renameTitle(id, title)
      }}
      onConvertToTask={() => {
        note.convertToTask(id)
      }}
      onSetLabelColorOverride={labelColorOverride => {
        windowCommands.setLabelColorOverride([id], labelColorOverride)
      }}
      onInteractionStart={options => {
        if (options?.clearSelection === true) {
          window.setTimeout(() => {
            windowCommands.clearSelection()
          }, 0)
        }

        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            windowCommands.select(id, { toggle: true })
            return
          }

          windowCommands.select(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        windowCommands.focusForInteraction(id)
      }}
    />
  )
}
