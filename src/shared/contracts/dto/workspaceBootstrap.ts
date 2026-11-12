export interface BootstrapSpaceDto {
  id: string
  name: string
  directoryPath: string
  parentSpaceId?: string | null
  rect: { x: number; y: number; width: number; height: number } | null
}

export interface CreateSpaceResult {
  projectId: string
  spaceId: string
  mountId: string
  space: BootstrapSpaceDto
}

export interface AddProjectResult extends CreateSpaceResult {
  project: { id: string; name: string; path: string }
}
