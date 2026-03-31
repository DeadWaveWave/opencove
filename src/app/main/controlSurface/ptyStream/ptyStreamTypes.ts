export type PtyStreamClientKind = 'web' | 'desktop' | 'cli' | 'unknown'
export type PtyStreamRole = 'viewer' | 'controller'

export type PtyStreamControllerDto = {
  clientId: string
  kind: PtyStreamClientKind
}
