import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { GitBranch, RefreshCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { NodeFrame, PluginNodeData, Point } from '../types'
import type { GitBoardSnapshot } from '@contexts/plugins/domain/pluginTypes'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'

interface GitBoardNodeProps {
  id: string
  data: PluginNodeData
  position: Point
  width: number
  height: number
  onClose: () => void
  onResize: (frame: NodeFrame) => void
  onInteractionStart?: () => void
}

function readSnapshot(data: PluginNodeData): Promise<GitBoardSnapshot> {
  const invoke = window.opencoveApi?.controlSurface?.invoke
  if (typeof invoke !== 'function') {
    return Promise.reject(new Error('Control surface unavailable'))
  }

  const useMount = Boolean(data.mountId)
  const statusRequest = useMount
    ? {
        kind: 'query' as const,
        id: 'gitWorktree.statusSummaryInMount',
        payload: { mountId: data.mountId, uri: toFileUri(data.repoPath) },
      }
    : {
        kind: 'query' as const,
        id: 'gitWorktree.statusSummary',
        payload: { repoPath: data.repoPath },
      }
  const graphRequest = useMount
    ? {
        kind: 'query' as const,
        id: 'gitWorktree.graphInMount',
        payload: { mountId: data.mountId, uri: toFileUri(data.repoPath), limit: data.graphLimit },
      }
    : {
        kind: 'query' as const,
        id: 'gitWorktree.graph',
        payload: { repoPath: data.repoPath, limit: data.graphLimit },
      }

  return Promise.all([
    invoke<Record<string, unknown>>(statusRequest),
    invoke<Record<string, unknown>>(graphRequest),
  ]).then(([status, graph]) => ({
    status: {
      repoPath: data.repoPath,
      branch: typeof graph.branch === 'string' ? graph.branch : null,
      head: typeof graph.head === 'string' ? graph.head : null,
      detached: graph.detached === true,
      clean: graph.clean === true,
      changedFileCount: typeof status.changedFileCount === 'number' ? status.changedFileCount : 0,
      stagedFileCount: typeof status.stagedFileCount === 'number' ? status.stagedFileCount : 0,
      unstagedFileCount:
        typeof status.unstagedFileCount === 'number' ? status.unstagedFileCount : 0,
      untrackedFileCount:
        typeof status.untrackedFileCount === 'number' ? status.untrackedFileCount : 0,
      ahead: typeof graph.ahead === 'number' ? graph.ahead : 0,
      behind: typeof graph.behind === 'number' ? graph.behind : 0,
      conflicts: typeof status.conflicts === 'number' ? status.conflicts : 0,
    },
    commits: Array.isArray(graph.commits) ? (graph.commits as GitBoardSnapshot['commits']) : [],
    fetchedAt: new Date().toISOString(),
  }))
}

export function GitBoardNode({
  data,
  position,
  width,
  height,
  onClose,
  onResize,
  onInteractionStart,
}: GitBoardNodeProps): JSX.Element {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<GitBoardSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: resolveCanonicalNodeMinSize('plugin'),
    onResize,
  })
  const renderedFrame = draftFrame ?? { position, size: { width, height } }
  const style = useMemo(
    () => ({ width: renderedFrame.size.width, height: renderedFrame.size.height }),
    [renderedFrame.size.height, renderedFrame.size.width],
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const next = await readSnapshot(data)
      setSnapshot(next)
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('plugins.gitBoard.unavailable'))
    } finally {
      setRefreshing(false)
    }
  }, [data, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const status = snapshot?.status
  return (
    <section
      className="git-board-node"
      style={style}
      onPointerDown={event => {
        if (event.button === 0) {
          onInteractionStart?.()
        }
      }}
    >
      <header className="git-board-node__header" data-node-drag-handle="true">
        <GitBranch className="git-board-node__icon" aria-hidden="true" />
        <strong>{t('plugins.gitBoard.title')}</strong>
        <span className="git-board-node__path">{status?.branch ?? data.repoPath}</span>
        <button
          type="button"
          className="git-board-node__refresh nodrag"
          onClick={event => {
            event.stopPropagation()
            void refresh()
          }}
          aria-label={t('plugins.gitBoard.refresh')}
          title={t('plugins.gitBoard.refresh')}
        >
          <RefreshCw
            size={14}
            className={refreshing ? 'git-board-node__refresh--spinning' : ''}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="git-board-node__close nodrag"
          onClick={event => {
            event.stopPropagation()
            onClose()
          }}
          aria-label={t('plugins.gitBoard.close')}
        >
          ×
        </button>
      </header>
      <div className="git-board-node__body nodrag nowheel">
        {error ? (
          <div className="git-board-node__error">
            {t('plugins.gitBoard.unavailable')}: {error}
          </div>
        ) : null}
        {status ? (
          <div className="git-board-node__summary">
            <span className={status.clean ? 'git-board-node__clean' : 'git-board-node__dirty'}>
              {status.clean
                ? t('plugins.gitBoard.clean')
                : t('plugins.gitBoard.changes', { count: status.changedFileCount })}
            </span>
            <span>
              {status.ahead ? `↑${status.ahead}` : ''}
              {status.behind ? ` ↓${status.behind}` : ''}
            </span>
            {status.conflicts ? (
              <span className="git-board-node__conflicts">
                {t('plugins.gitBoard.conflicts', { count: status.conflicts })}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="git-board-node__graph" aria-label={t('plugins.gitBoard.graph')}>
          {snapshot?.commits.length ? (
            snapshot.commits.map((commit, index) => (
              <div className="git-board-node__commit" key={commit.commit}>
                <span className="git-board-node__rail" aria-hidden="true">
                  <span className="git-board-node__dot" />
                </span>
                <span className="git-board-node__commit-meta">{commit.shortCommit}</span>
                <span className="git-board-node__subject">{commit.subject}</span>
                {index === 0 && status?.branch ? (
                  <span className="git-board-node__ref">{status.branch}</span>
                ) : null}
              </div>
            ))
          ) : (
            <div className="git-board-node__empty">
              {error ? '' : t('plugins.gitBoard.noCommits')}
            </div>
          )}
        </div>
      </div>
      <NodeResizeHandles
        classNamePrefix="git-board-node"
        testIdPrefix="git-board-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </section>
  )
}
