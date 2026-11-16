import type { RmOptions } from 'node:fs'
import { rename, rm } from 'node:fs/promises'

// The only place the lease reaches rename and rm. The lease module gets them through its port so
// that every call passes the platform policy.
export const defaultLeaseFileSystemOperations = {
  rename: async (from: string, to: string): Promise<void> => await rename(from, to),
  rm: async (path: string, options?: RmOptions): Promise<void> => await rm(path, options),
}
