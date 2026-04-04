export type WebsiteWindowSessionMode = 'shared' | 'incognito' | 'profile'

export type WebsiteWindowLifecycle = 'active' | 'warm' | 'cold'

export interface WebsiteWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WebsiteWindowPolicy {
  enabled: boolean
  maxActiveCount: number
  discardAfterMinutes: number
  keepAliveHosts: string[]
}

export interface ConfigureWebsiteWindowPolicyInput {
  policy: WebsiteWindowPolicy
}

export interface SetWebsiteWindowOccludedInput {
  occluded: boolean
}

export interface ActivateWebsiteWindowInput {
  nodeId: string
  url: string
  pinned: boolean
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
  bounds?: WebsiteWindowBounds | null
  viewportBounds?: WebsiteWindowBounds | null
  canvasZoom?: number | null
}

export interface SetWebsiteWindowBoundsInput {
  nodeId: string
  bounds: WebsiteWindowBounds
  viewportBounds?: WebsiteWindowBounds | null
  canvasZoom?: number | null
}

export interface NavigateWebsiteWindowInput {
  nodeId: string
  url: string
}

export interface WebsiteWindowNodeIdInput {
  nodeId: string
}

export interface SetWebsiteWindowPinnedInput {
  nodeId: string
  pinned: boolean
}

export interface SetWebsiteWindowSessionInput {
  nodeId: string
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
}

export interface CaptureWebsiteWindowSnapshotInput {
  nodeId: string
  quality?: number | null
}

export interface WebsiteWindowStateEvent {
  type: 'state'
  nodeId: string
  lifecycle: WebsiteWindowLifecycle
  isOccluded: boolean
  url: string | null
  title: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface WebsiteWindowSnapshotEvent {
  type: 'snapshot'
  nodeId: string
  dataUrl: string | null
}

export interface WebsiteWindowClosedEvent {
  type: 'closed'
  nodeId: string
}

export interface WebsiteWindowErrorEvent {
  type: 'error'
  nodeId: string
  message: string
}

export interface WebsiteWindowOpenUrlEvent {
  type: 'open-url'
  sourceNodeId: string
  url: string
}

export type WebsiteWindowEventPayload =
  | WebsiteWindowStateEvent
  | WebsiteWindowSnapshotEvent
  | WebsiteWindowClosedEvent
  | WebsiteWindowErrorEvent
  | WebsiteWindowOpenUrlEvent
