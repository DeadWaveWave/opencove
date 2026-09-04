import type { PtyRuntime } from '../../../../contexts/terminal/presentation/main-ipc/runtime'

export type RemotePtyRuntime = PtyRuntime & {
  noteSessionRolePreference: (sessionId: string, role: 'viewer' | 'controller') => void
}

export function isRemotePtyRuntime(value: PtyRuntime): value is RemotePtyRuntime {
  return typeof (value as RemotePtyRuntime).noteSessionRolePreference === 'function'
}
