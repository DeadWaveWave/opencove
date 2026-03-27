export type MountTargetScheme = 'file'

export interface MountTarget {
  scheme: MountTargetScheme
  rootPath: string
  rootUri: string
}
