export interface ControlSurfacePingResult {
  ok: true
  now: string
  pid: number
}

export type CanvasNodeKind = 'terminal' | 'agent' | 'task' | 'note' | 'image' | 'unknown'

export interface CanvasNodeSummary {
  id: string
  kind: CanvasNodeKind
  title: string
  status?: string | null
}

export interface ListProjectsResult {
  activeProjectId: string | null
  projects: Array<{
    id: string
    name: string
    path: string
    worktreesRoot: string
    activeSpaceId: string | null
  }>
}

export interface ListSpacesInput {
  projectId?: string | null
}

export interface ListSpacesResult {
  projectId: string | null
  activeSpaceId: string | null
  spaces: Array<{
    id: string
    name: string
    directoryPath: string
    nodeIds: string[]
    nodes: CanvasNodeSummary[]
  }>
}

export interface GetSpaceInput {
  spaceId: string
}

export interface GetSpaceResult {
  projectId: string
  activeSpaceId: string | null
  space: {
    id: string
    name: string
    directoryPath: string
    nodeIds: string[]
    nodes: CanvasNodeSummary[]
  }
}
