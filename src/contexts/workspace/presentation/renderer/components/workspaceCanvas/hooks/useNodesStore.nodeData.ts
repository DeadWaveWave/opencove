import type { TerminalNodeData } from '../../../types'

export const EMPTY_NODE_KIND_DATA: Pick<
  TerminalNodeData,
  'agent' | 'task' | 'note' | 'image' | 'document' | 'website'
> = {
  agent: null,
  task: null,
  note: null,
  image: null,
  document: null,
  website: null,
}
