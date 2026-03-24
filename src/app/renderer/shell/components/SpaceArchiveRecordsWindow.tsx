import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  SpaceArchiveNodeSnapshot,
  SpaceArchiveRecord,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toRelativeTime } from '../utils/format'
import { SpaceArchiveReplayCanvas } from './SpaceArchiveReplayCanvas'

function countRecordNodes(record: SpaceArchiveRecord): {
  terminal: number
  agent: number
  task: number
  note: number
} {
  const counts = { terminal: 0, agent: 0, task: 0, note: 0 }

  for (const node of record.nodes) {
    if (node.kind === 'terminal') {
      counts.terminal += 1
    } else if (node.kind === 'agent') {
      counts.agent += 1
    } else if (node.kind === 'task') {
      counts.task += 1
    } else if (node.kind === 'note') {
      counts.note += 1
    }
  }

  return counts
}

function getNodeKindLabelKey(kind: SpaceArchiveNodeSnapshot['kind']): string {
  switch (kind) {
    case 'terminal':
      return 'spaceArchivesWindow.nodeKinds.terminal'
    case 'agent':
      return 'spaceArchivesWindow.nodeKinds.agent'
    case 'task':
      return 'spaceArchivesWindow.nodeKinds.task'
    case 'note':
      return 'spaceArchivesWindow.nodeKinds.note'
    default:
      return 'spaceArchivesWindow.nodeKinds.terminal'
  }
}

export function SpaceArchiveRecordsWindow({
  isOpen,
  workspace,
  onClose,
}: {
  isOpen: boolean
  workspace: WorkspaceState | null
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!isOpen) {
    return null
  }

  const records = workspace?.spaceArchiveRecords ?? []

  return (
    <div
      className="cove-window-backdrop space-archives-backdrop"
      data-testid="space-archives-window-backdrop"
      onClick={() => {
        onClose()
      }}
    >
      <section
        className="cove-window space-archives-window"
        data-testid="space-archives-window"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <header className="space-archives-window__header">
          <div className="space-archives-window__title-group">
            <h3>{t('spaceArchivesWindow.title')}</h3>
            {workspace ? (
              <p className="space-archives-window__subtitle">
                {t('spaceArchivesWindow.subtitle', { workspaceName: workspace.name })}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            onClick={() => {
              onClose()
            }}
          >
            {t('common.close')}
          </button>
        </header>

        <div className="space-archives-window__body">
          {!workspace ? (
            <p className="space-archives-window__empty">{t('spaceArchivesWindow.noWorkspace')}</p>
          ) : records.length === 0 ? (
            <p className="space-archives-window__empty">{t('spaceArchivesWindow.empty')}</p>
          ) : (
            <div className="space-archives-window__list" data-testid="space-archives-window-list">
              {records.map(record => {
                const counts = countRecordNodes(record)
                const timeLabel = toRelativeTime(record.archivedAt)
                const gitLabel = record.git?.branch
                  ? `${t('worktree.branch')}: ${record.git.branch}`
                  : record.git?.head
                    ? `${t('worktree.detached')}: ${record.git.head.trim().slice(0, 7)}`
                    : null
                const summaryParts = [
                  counts.terminal > 0
                    ? t('spaceArchivesWindow.counts.terminals', { count: counts.terminal })
                    : null,
                  counts.agent > 0
                    ? t('spaceArchivesWindow.counts.agents', { count: counts.agent })
                    : null,
                  counts.task > 0
                    ? t('spaceArchivesWindow.counts.tasks', { count: counts.task })
                    : null,
                  counts.note > 0
                    ? t('spaceArchivesWindow.counts.notes', { count: counts.note })
                    : null,
                ].filter(Boolean)

                return (
                  <details
                    key={record.id}
                    className="space-archives-window__record"
                    data-testid="space-archives-window-record"
                  >
                    <summary className="space-archives-window__record-summary">
                      <div className="space-archives-window__record-main">
                        <div className="space-archives-window__record-title">
                          {record.space.name}
                        </div>
                        <div className="space-archives-window__record-meta">
                          <span title={record.archivedAt}>{timeLabel}</span>
                          <span className="space-archives-window__meta-divider" aria-hidden="true">
                            ·
                          </span>
                          {gitLabel ? (
                            <>
                              <span
                                className="space-archives-window__record-branch"
                                title={gitLabel}
                              >
                                {gitLabel}
                              </span>
                              <span
                                className="space-archives-window__meta-divider"
                                aria-hidden="true"
                              >
                                ·
                              </span>
                            </>
                          ) : null}
                          <span
                            className="space-archives-window__record-path"
                            title={record.space.directoryPath}
                          >
                            {record.space.directoryPath}
                          </span>
                        </div>
                      </div>

                      {summaryParts.length > 0 ? (
                        <div className="space-archives-window__record-counts">
                          {summaryParts.join(' · ')}
                        </div>
                      ) : null}
                    </summary>

                    <div className="space-archives-window__record-body">
                      <SpaceArchiveReplayCanvas record={record} />
                      {record.nodes.length === 0 ? (
                        <p className="space-archives-window__empty">
                          {t('spaceArchivesWindow.emptySnapshot')}
                        </p>
                      ) : (
                        <div className="space-archives-window__nodes">
                          {record.nodes.map(node => (
                            <div key={node.id} className="space-archives-window__node">
                              <div className="space-archives-window__node-header">
                                <span className="space-archives-window__node-kind">
                                  {t(getNodeKindLabelKey(node.kind))}
                                </span>
                                <strong className="space-archives-window__node-title">
                                  {node.title}
                                </strong>
                              </div>

                              {node.kind === 'task' ? (
                                <pre className="space-archives-window__node-text">
                                  {node.requirement}
                                </pre>
                              ) : null}

                              {node.kind === 'note' ? (
                                <pre className="space-archives-window__node-text">{node.text}</pre>
                              ) : null}

                              {node.kind === 'agent' ? (
                                <>
                                  <div className="space-archives-window__node-kv">
                                    <span className="space-archives-window__node-key">
                                      {t('spaceArchivesWindow.fields.provider')}
                                    </span>
                                    <span className="space-archives-window__node-value">
                                      {node.provider ?? '—'}
                                    </span>
                                  </div>
                                  <div className="space-archives-window__node-kv">
                                    <span className="space-archives-window__node-key">
                                      {t('spaceArchivesWindow.fields.model')}
                                    </span>
                                    <span className="space-archives-window__node-value">
                                      {node.effectiveModel ?? node.model ?? '—'}
                                    </span>
                                  </div>
                                  <div className="space-archives-window__node-kv">
                                    <span className="space-archives-window__node-key">
                                      {t('spaceArchivesWindow.fields.executionDirectory')}
                                    </span>
                                    <span className="space-archives-window__node-value">
                                      {node.executionDirectory ?? '—'}
                                    </span>
                                  </div>
                                  <div className="space-archives-window__node-kv">
                                    <span className="space-archives-window__node-key">
                                      {t('spaceArchivesWindow.fields.expectedDirectory')}
                                    </span>
                                    <span className="space-archives-window__node-value">
                                      {node.expectedDirectory ?? '—'}
                                    </span>
                                  </div>
                                  <pre className="space-archives-window__node-text">
                                    {node.prompt}
                                  </pre>
                                </>
                              ) : null}

                              {node.kind === 'terminal' ? (
                                <>
                                  <div className="space-archives-window__node-kv">
                                    <span className="space-archives-window__node-key">
                                      {t('spaceArchivesWindow.fields.executionDirectory')}
                                    </span>
                                    <span className="space-archives-window__node-value">
                                      {node.executionDirectory ?? '—'}
                                    </span>
                                  </div>
                                  <div className="space-archives-window__node-kv">
                                    <span className="space-archives-window__node-key">
                                      {t('spaceArchivesWindow.fields.expectedDirectory')}
                                    </span>
                                    <span className="space-archives-window__node-value">
                                      {node.expectedDirectory ?? '—'}
                                    </span>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
