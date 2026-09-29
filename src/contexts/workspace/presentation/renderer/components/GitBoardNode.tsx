import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginNodeData } from '../types'
import type { GitBoardSnapshot } from '@contexts/plugins/domain/pluginTypes'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import type { CanvasNodeWindowProps } from './shared/CanvasNodeWindow'
import { GitBoardNodeView } from './GitBoardNodeView'

interface GitBoardNodeProps extends Omit<CanvasNodeWindowProps, 'children'> {
  data: PluginNodeData
}

function readSnapshot(
  data: Pick<PluginNodeData, 'repoPath' | 'mountId' | 'graphLimit'>,
): Promise<GitBoardSnapshot> {
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

export function GitBoardNode({ data, ...windowProps }: GitBoardNodeProps): JSX.Element {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<GitBoardSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const requestGeneration = useRef(0)
  const { repoPath, mountId, graphLimit } = data

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current
    setRefreshing(true)
    try {
      const next = await readSnapshot({ repoPath, mountId, graphLimit })
      if (generation !== requestGeneration.current) {
        return
      }
      setSnapshot(next)
      setError(null)
    } catch (nextError) {
      if (generation !== requestGeneration.current) {
        return
      }
      setError(nextError instanceof Error ? nextError.message : t('plugins.gitBoard.unavailable'))
    } finally {
      if (generation === requestGeneration.current) {
        setRefreshing(false)
      }
    }
  }, [repoPath, mountId, graphLimit, t])

  useEffect(() => {
    setSnapshot(null)
    setError(null)
    void refresh()
    return () => {
      requestGeneration.current += 1
    }
  }, [refresh])

  return (
    <GitBoardNodeView
      {...windowProps}
      repoPath={repoPath}
      snapshot={snapshot}
      error={error}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    />
  )
}
