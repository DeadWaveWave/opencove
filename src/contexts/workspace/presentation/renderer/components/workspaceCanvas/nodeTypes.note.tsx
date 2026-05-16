import type { MutableRefObject, ReactElement } from 'react'
import { NoteNode } from '../NoteNode'
import type { NodeFrame, TerminalNodeData } from '../../types'
import type { LabelColor, NodeLabelColorOverride } from '@shared/types/labelColor'
import { useNodePosition } from './nodePosition'

export function WorkspaceCanvasNoteNodeType({
  data,
  id,
  selectNode,
  clearNodeSelectionRef,
  closeNodeRef,
  resizeNodeRef,
  updateNoteTextRef,
  renameNoteTitleRef,
  convertNoteToTask,
  setNodeLabelColorOverride,
  normalizeViewportForTerminalInteractionRef,
  onShowMessage,
}: {
  data: TerminalNodeData
  id: string
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  clearNodeSelectionRef: MutableRefObject<() => void>
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  updateNoteTextRef: MutableRefObject<(nodeId: string, text: string) => void>
  renameNoteTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  convertNoteToTask: (nodeId: string) => boolean
  setNodeLabelColorOverride: (nodeIds: string[], labelColorOverride: NodeLabelColorOverride) => void
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
  onShowMessage?: (message: string, tone?: 'info' | 'warning' | 'error') => void
}): ReactElement | null {
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
        void closeNodeRef.current(id)
      }}
      onResize={frame => resizeNodeRef.current(id, frame)}
      onTextChange={text => {
        updateNoteTextRef.current(id, text)
      }}
      onTitleChange={title => {
        renameNoteTitleRef.current(id, title)
      }}
      onConvertToTask={() => {
        convertNoteToTask(id)
      }}
      onSetLabelColorOverride={labelColorOverride => {
        setNodeLabelColorOverride([id], labelColorOverride)
      }}
      onInteractionStart={options => {
        if (options?.clearSelection === true) {
          window.setTimeout(() => {
            clearNodeSelectionRef.current()
          }, 0)
        }

        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            selectNode(id, { toggle: true })
            return
          }

          selectNode(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        normalizeViewportForTerminalInteractionRef.current(id)
      }}
    />
  )
}
