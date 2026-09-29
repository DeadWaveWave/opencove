import type { Node } from '@xyflow/react'
import type { GitBoardSnapshot } from '../../domain/pluginTypes'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { EMPTY_NODE_KIND_DATA } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.nodeData'
import { NODE_DRAG_HANDLE_SELECTOR } from '@contexts/workspace/presentation/renderer/utils/nodeFrameResize'

export const PREVIEW_NODE_ID = 'plugin-preview-git-board'
export const PREVIEW_CANVAS_SIZE = { width: 616, height: 380 }
export const COMPACT_PREVIEW_CANVAS_SIZE = { width: 360, height: 344 }

export function createPreviewNode(compact = false): Node<TerminalNodeData> {
  const canvasSize = compact ? COMPACT_PREVIEW_CANVAS_SIZE : PREVIEW_CANVAS_SIZE
  return {
    id: PREVIEW_NODE_ID,
    type: 'pluginPreview',
    position: compact ? { x: 20, y: 24 } : { x: 48, y: 42 },
    dragHandle: NODE_DRAG_HANDLE_SELECTOR,
    extent: [
      [8, 8],
      [canvasSize.width - 8, canvasSize.height - 8],
    ],
    data: {
      ...EMPTY_NODE_KIND_DATA,
      title: 'Git Board',
      kind: 'plugin',
      sessionId: '',
      width: compact ? 320 : 520,
      height: compact ? 276 : 292,
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      plugin: {
        pluginId: 'git-board',
        schemaVersion: 1,
        repoPath: '/example/opencove',
        mountId: null,
        graphLimit: 30,
      },
    },
  }
}

/** Deterministic sample data; no repository, worker or application settings are involved. */
export function createPreviewSnapshot(refreshed = false): GitBoardSnapshot {
  const subjects = [
    ...(refreshed ? ['Polish the canvas preview'] : []),
    'Refine plugin window controls',
    'Add a vertical commit graph',
    'Share the canvas window shell',
    'Introduce Git Board',
  ]
  const commits = subjects.map((subject, index) => ({
    commit: `f8a${index}b1c${'0'.repeat(33)}`,
    shortCommit: `f8a${index}b1c`,
    parents: index < subjects.length - 1 ? [`f8a${index + 1}b1c${'0'.repeat(33)}`] : [],
    branch: index === 0 ? 'feat/plugin-host' : null,
    refs: index === 0 ? ['HEAD -> feat/plugin-host'] : [],
    subject,
    author: 'OpenCove',
    authoredAt: '2026-09-29T08:00:00.000Z',
  }))
  return {
    status: {
      repoPath: '/example/opencove',
      branch: 'feat/plugin-host',
      head: commits[0].commit,
      detached: false,
      clean: false,
      changedFileCount: refreshed ? 2 : 3,
      stagedFileCount: 1,
      unstagedFileCount: refreshed ? 1 : 2,
      untrackedFileCount: 0,
      ahead: refreshed ? 3 : 2,
      behind: 0,
      conflicts: 0,
    },
    commits,
    fetchedAt: '2026-09-29T08:00:00.000Z',
  }
}
