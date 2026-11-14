import type {
  AppendNoteInput,
  AppendNoteResult,
} from '../../../../shared/contracts/dto/taskMutation'
import { createAppError } from '../../../../shared/errors/appError'
import { findNodeForNodeControl } from './nodeDtos'
import { replaceNodeControlWorkspace, type NodeControlAppStateStore } from './nodeControlState'
import {
  assertMutationProject,
  commitNodeMutation,
  nodePayload,
  type NodeMutationAuthority,
} from './nodeMutationCommit'
import {
  NOTE_APPEND_MAX_BYTES,
  NOTE_BODY_MAX_BYTES,
  utf8Bytes,
} from '../../../../shared/contracts/noteAppend'

export async function appendNote(options: {
  store: NodeControlAppStateStore
  input: AppendNoteInput
  authority?: NodeMutationAuthority
  assertActive?: () => void
}): Promise<AppendNoteResult> {
  const { text } = options.input
  if (text.length === 0 || utf8Bytes(text) > NOTE_APPEND_MAX_BYTES) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Append text must contain 1 to 65,536 UTF-8 bytes.',
    })
  }
  return commitNodeMutation({
    ...options,
    plan: state => {
      const target = findNodeForNodeControl(state.workspaces, options.input.nodeId)
      if (!target) {
        throw createAppError('node.not_found')
      }
      assertMutationProject(target.workspace.id, options.authority)
      if (target.node.kind !== 'note') {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Choose a note node to append text.',
        })
      }
      const data = nodePayload(target.node.task)
      const existing = typeof data.text === 'string' ? data.text : ''
      const addition = existing === '' ? text : '\n\n' + text
      const nextText = existing + addition
      const totalBytes = utf8Bytes(nextText)
      if (totalBytes > NOTE_BODY_MAX_BYTES) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'The note would exceed 1,048,576 UTF-8 bytes. Use another note.',
        })
      }
      const workspace = {
        ...target.workspace,
        nodes: target.workspace.nodes.map(n =>
          n.id === target.node.id ? { ...n, task: { ...data, text: nextText } } : n,
        ),
      }
      return {
        state: replaceNodeControlWorkspace(state, workspace),
        value: { nodeId: target.node.id, appendedBytes: utf8Bytes(addition), totalBytes },
      }
    },
  })
}
