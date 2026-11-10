export interface SpaceUpdateFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface UpdateSpaceInput {
  spaceId: string
  name?: string
  frame?: Partial<SpaceUpdateFrame>
}

export interface UpdateSpaceResult {
  id: string
  name: string
  projectId: string
  parentSpaceId: string | null
  rect: SpaceUpdateFrame | null
  directoryPath: string
  movedNodeIds: string[]
  appliedFrame?: SpaceUpdateFrame
  frameAdjusted?: boolean
}
