export interface WorkspaceDirectory {
  id: string
  name: string
  path: string
}

export const CANVAS_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
] as const

export type CanvasImageMimeType = (typeof CANVAS_IMAGE_MIME_TYPES)[number]

export const MAX_CANVAS_IMAGE_BYTES = 20 * 1024 * 1024

export interface WriteCanvasImageInput {
  assetId: string
  bytes: Uint8Array
  mimeType: CanvasImageMimeType
  fileName: string | null
}

export interface ReadCanvasImageInput {
  assetId: string
}

export interface ReadCanvasImageResult {
  bytes: Uint8Array
}

export interface DeleteCanvasImageInput {
  assetId: string
}

export interface EnsureDirectoryInput {
  path: string
}

export interface AllocateProjectPlaceholderInput {
  projectId: string
}

export interface AllocateProjectPlaceholderResult {
  path: string
}

export interface CopyWorkspacePathInput {
  path: string
}

export const WORKSPACE_PATH_OPENER_IDS = [
  'vscode',
  'cursor',
  'windsurf',
  'zed',
  'antigravity',
  'vscode-insiders',
  'vscodium',
  'intellij-idea',
  'fleet',
  'android-studio',
  'xcode',
  'pycharm',
  'webstorm',
  'goland',
  'clion',
  'phpstorm',
  'rubymine',
  'datagrip',
  'rider',
  'sublime-text',
  'nova',
  'bbedit',
  'textmate',
  'coteditor',
  'finder',
  'terminal',
  'iterm',
  'warp',
  'ghostty',
] as const

export type WorkspacePathOpenerId = (typeof WORKSPACE_PATH_OPENER_IDS)[number]

export interface WorkspacePathOpener {
  id: WorkspacePathOpenerId
  label: string
}

export interface ListWorkspacePathOpenersResult {
  openers: WorkspacePathOpener[]
}

export interface OpenWorkspacePathInput {
  path: string
  openerId: WorkspacePathOpenerId
}
