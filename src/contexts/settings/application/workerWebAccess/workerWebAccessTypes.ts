import type { HomeWorkerConfigFile, HomeWorkerWebUiConfigFile } from '../../domain/homeWorkerConfig'

export type WorkerWebListenerAddress = {
  hostname: string
  bindHostname: string
  port: number
}

export type WorkerWebListener = {
  ready: Promise<WorkerWebListenerAddress>
  activate: () => void
  updateWebUiPasswordHash: (passwordHash: string | null) => void
  closeStreamingClients: () => void
  stopAccepting: (options?: {
    preserveStreamingClients?: boolean
    drainTimeoutMs?: number
  }) => Promise<void>
  dispose: () => Promise<void>
}

export type WorkerWebAccessPort = {
  listen: (options: {
    hostname: string
    bindHostname: string
    port: number
    role: 'web'
    enableWebShell: true
    webUiPasswordHash: string | null
    startGated: true
    webAccessGeneration: number
  }) => WorkerWebListener
  setWebAccessPolicy: (policy: { enabled: boolean; passwordRequired: boolean }) => void
  rotateWebSessionGeneration: () => { previousGeneration: number; generation: number }
  closePtyStreamClients: (filter: {
    listenerRole?: 'web'
    webAccessGeneration?: number
    webSessionGeneration?: number
    nonLoopbackOnly?: boolean
  }) => number
}

export type WorkerWebAccessRuntimeStatus =
  | {
      state: 'disabled'
      generation: number
      drainingGenerations: number[]
    }
  | {
      state: 'active'
      generation: number
      address: WorkerWebListenerAddress
      passwordRequired: boolean
      drainingGenerations: number[]
    }
  | {
      state: 'degraded'
      generation: number
      address: WorkerWebListenerAddress
      passwordRequired: boolean
      error: string
      drainingGenerations: number[]
    }
  | {
      state: 'failed'
      generation: number
      error: string
      drainingGenerations: number[]
    }

export interface WorkerWebAccessRuntime {
  ready: Promise<WorkerWebAccessRuntimeStatus>
  status: () => WorkerWebAccessRuntimeStatus
  apply: (input: {
    next: HomeWorkerConfigFile
    expectedUpdatedAt: string | null
  }) => Promise<{ config: HomeWorkerConfigFile; status: WorkerWebAccessRuntimeStatus }>
  dispose: () => Promise<void>
}

export type ActiveWebListener = {
  generation: number
  config: HomeWorkerWebUiConfigFile
  listener: WorkerWebListener
  address: WorkerWebListenerAddress
}

export type DegradedWebListener = {
  previous: ActiveWebListener
  error: string
}

export type PersistWebConfig = (input: {
  next: HomeWorkerConfigFile
  expectedUpdatedAt: string | null
}) => Promise<HomeWorkerConfigFile>
