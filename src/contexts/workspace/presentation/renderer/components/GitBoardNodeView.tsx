import type { JSX } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { GitBoardSnapshot } from '@contexts/plugins/domain/pluginTypes'
import { CanvasNodeWindow, type CanvasNodeWindowProps } from './shared/CanvasNodeWindow'

export interface GitBoardNodeViewProps extends Omit<CanvasNodeWindowProps, 'children'> {
  repoPath: string
  snapshot: GitBoardSnapshot | null
  error?: string | null
  refreshing?: boolean
  onRefresh: () => void
}

/** Shared runtime/preview view. Data acquisition stays with the mounting owner. */
export function GitBoardNodeView({
  repoPath,
  snapshot,
  error = null,
  refreshing = false,
  onRefresh,
  testIdPrefix = 'git-board',
  ...windowProps
}: GitBoardNodeViewProps): JSX.Element {
  const { t } = useTranslation()
  const status = snapshot?.status
  return (
    <CanvasNodeWindow
      {...windowProps}
      pluginId="git-board"
      className="git-board-node"
      testIdPrefix={testIdPrefix}
      subtitle={status?.branch ?? repoPath}
      closeLabel={t('plugins.gitBoard.close')}
      headerActions={
        <button
          type="button"
          className="cove-canvas-node-window__action"
          data-testid={`${testIdPrefix}-refresh`}
          disabled={refreshing}
          onClick={event => {
            event.stopPropagation()
            onRefresh()
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
      }
    >
      <div className="git-board-node__body" aria-busy={refreshing}>
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
              {error ? '' : t(refreshing ? 'common.loading' : 'plugins.gitBoard.noCommits')}
            </div>
          )}
        </div>
      </div>
    </CanvasNodeWindow>
  )
}
