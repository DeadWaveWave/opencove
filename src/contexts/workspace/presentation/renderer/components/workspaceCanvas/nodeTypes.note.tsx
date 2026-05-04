import type { MutableRefObject, ReactElement } from 'react'
import { NoteNode } from '../NoteNode'
import type { NodeFrame, TerminalNodeData, WorkspaceSpaceState } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import { useNodePosition } from './nodePosition'

export function WorkspaceCanvasNoteNodeType({
  data,
  id,
  spacesRef,
  workspacePath,
  selectNode,
  clearNodeSelectionRef,
  closeNodeRef,
  resizeNodeRef,
  updateNoteTextRef,
  renameNoteTitleRef,
  normalizeViewportForTerminalInteractionRef,
}: {
  data: TerminalNodeData
  id: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  clearNodeSelectionRef: MutableRefObject<() => void>
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  updateNoteTextRef: MutableRefObject<(nodeId: string, text: string) => void>
  renameNoteTitleRef: MutableRefObject<(nodeId: string, title: string) => void>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
}): ReactElement | null {
  const nodePosition = useNodePosition(id)
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null

  if (!data.note) {
    return null
  }

  const containingSpace =
    spacesRef.current.find(candidate => candidate.nodeIds.includes(id)) ?? null
  const containingSpaceDirectory = containingSpace?.directoryPath.trim() ?? ''
  const saveDirectoryPath =
    containingSpaceDirectory.length > 0 ? containingSpaceDirectory : workspacePath

  return (
    <NoteNode
      title={data.title}
      text={data.note.text}
      labelColor={labelColor}
      position={nodePosition}
      width={data.width}
      height={data.height}
      saveDirectoryPath={saveDirectoryPath}
      saveMountId={containingSpace?.targetMountId ?? null}
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
