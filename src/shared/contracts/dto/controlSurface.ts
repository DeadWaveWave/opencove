export interface ControlSurfacePingResult {
  ok: true
  now: string
  pid: number
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
  spaces: Array<{
    id: string
    name: string
    directoryPath: string
    nodeIds: string[]
  }>
}
