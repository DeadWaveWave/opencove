import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../src/contexts/workspace/presentation/renderer/types'
import { sized, type RuntimeCanvasContext } from './agentRuntimeHarness'
import { pixelNode } from '../unit/contexts/workspacePixelLayer.fixtures'

// The node store's creators, one call each, for the specs that place and flush them.

export const ANCHOR = { x: 20, y: 20 }
export const FOLDER = {
  uri: 'file:///root/dir',
  rootUri: 'file:///root',
  viewMode: 'icons' as const,
  expandedDirectoryUris: [] as string[],
}
export const LOCAL = { endpointId: 'local', mountId: null }

export function blockerNode(id = 'blocker', overrides: Partial<TerminalNodeData> = {}) {
  return sized({
    id,
    type: 'noteNode',
    position: { x: 0, y: 0 },
    data: {
      ...pixelNode({ kind: 'note', sessionId: '', note: { text: '' } }).data,
      width: 1200,
      height: 900,
      ...overrides,
    },
  })
}

export type Creation = (
  context: RuntimeCanvasContext,
) => Node<TerminalNodeData> | Promise<unknown> | null

export const CREATIONS: Record<string, Creation> = {
  'a session node': ({ nodeStore }) =>
    nodeStore.createNodeForSession({
      sessionId: 'pty-new',
      title: 'Terminal',
      anchor: ANCHOR,
      kind: 'terminal',
    }),
  'a note': ({ nodeStore }) => nodeStore.createNoteNode(ANCHOR),
  'a note placed to the right': ({ nodeStore }) =>
    nodeStore.createNoteNode(ANCHOR, { placementStrategy: 'right-no-push' }),
  'a task': ({ nodeStore }) =>
    nodeStore.createTaskNode(ANCHOR, 'Task', 'Do it', false, 'medium', []),
  'a role': ({ nodeStore }) =>
    nodeStore.createRoleNode(ANCHOR, {
      id: 'role-1',
      name: 'Reviewer',
      description: '',
      promptTemplate: '',
      inputHint: '',
      outputFormat: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  'an image': ({ nodeStore }) =>
    nodeStore.createImageNode(ANCHOR, {
      assetId: 'asset-new',
      mimeType: 'image/png',
      fileName: 'a.png',
      naturalWidth: 100,
      naturalHeight: 100,
    }),
  'a document': ({ nodeStore }) =>
    nodeStore.createDocumentNode(ANCHOR, { uri: 'file:///root/a.md' }, undefined, LOCAL),
  'a collapsed document': ({ nodeStore, workspaceId }) =>
    nodeStore.createDocumentNode(ANCHOR, { uri: 'file:///root/a.md' }, undefined, LOCAL, {
      workspaceId,
      collapsed: true,
    }),
  'a folder': ({ nodeStore, workspaceId }) =>
    nodeStore.createFolderNode(ANCHOR, FOLDER, LOCAL, workspaceId),
  'a website': ({ nodeStore }) =>
    nodeStore.createWebsiteNode(ANCHOR, {
      url: 'https://example.com',
      pinned: false,
      sessionMode: 'shared',
      profileId: null,
    }),
}

/** Created collapsed: the node keeps its full size in its data and is placed with the collapsed one. */
export const COLLAPSED_CREATIONS = new Set(['a collapsed document', 'a folder'])
