import React from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import type {
  SpaceArchiveRecord,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toLocalDateTime, toRelativeTime } from '../utils/format'
import { SpaceArchiveReplayCanvas } from './SpaceArchiveReplayCanvas'

const EMPTY_RECORDS: SpaceArchiveRecord[] = []

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

export function SpaceArchiveRecordsWindow({
  isOpen,
  workspace,
  canvasInputModeSetting,
  onDeleteRecord,
  onClose,
}: {
  isOpen: boolean
  workspace: WorkspaceState | null
  canvasInputModeSetting: 'mouse' | 'trackpad' | 'auto'
  onDeleteRecord: (recordId: string) => void
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const records = workspace?.spaceArchiveRecords ?? EMPTY_RECORDS
  const [selectedRecordId, setSelectedRecordId] = React.useState<string | null>(null)
  const [recordContextMenu, setRecordContextMenu] = React.useState<{
    recordId: string
    x: number
    y: number
  } | null>(null)

  React.useEffect(() => {
    if (!workspace || records.length === 0) {
      setSelectedRecordId(null)
      return
    }

    if (!selectedRecordId || !records.some(record => record.id === selectedRecordId)) {
      setSelectedRecordId(records[0].id)
    }
  }, [records, selectedRecordId, workspace])

  React.useEffect(() => {
    if (!isOpen) {
      setRecordContextMenu(null)
    }
  }, [isOpen])

  const selectedRecord = selectedRecordId
    ? (records.find(record => record.id === selectedRecordId) ?? null)
    : null

  if (!isOpen) {
    return null
  }

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

        {!workspace ? (
          <div className="space-archives-window__empty">{t('spaceArchivesWindow.noWorkspace')}</div>
        ) : records.length === 0 ? (
          <div className="space-archives-window__empty">{t('spaceArchivesWindow.empty')}</div>
        ) : (
          <div className="space-archives-window__content">
            <aside className="space-archives-window__sidebar">
              <div className="space-archives-window__list" data-testid="space-archives-window-list">
                {records.map(record => {
                  const counts = countRecordNodes(record)
                  const timeLabel = toLocalDateTime(record.archivedAt)
                  const relativeTimeLabel = toRelativeTime(record.archivedAt)
                  const isSelected = record.id === selectedRecordId

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

                  const branchLabel = record.git?.branch
                    ? record.git.branch
                    : record.git?.head
                      ? record.git.head.trim().slice(0, 7)
                      : null

                  const prLabel = record.git?.pullRequest?.number
                    ? `#${record.git.pullRequest.number}`
                    : null

                  return (
                    <button
                      key={record.id}
                      type="button"
                      className="space-archives-window__record"
                      data-testid="space-archives-window-record"
                      data-selected={isSelected ? 'true' : 'false'}
                      onClick={() => {
                        setSelectedRecordId(record.id)
                        setRecordContextMenu(null)
                      }}
                      onContextMenu={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        setSelectedRecordId(record.id)
                        setRecordContextMenu({
                          recordId: record.id,
                          x: event.clientX,
                          y: event.clientY,
                        })
                      }}
                    >
                      <div className="space-archives-window__record-title-row">
                        <span className="space-archives-window__record-title">
                          {record.space.name}
                        </span>
                        <span
                          className="space-archives-window__record-time"
                          title={`${relativeTimeLabel} · ${record.archivedAt}`}
                        >
                          {timeLabel}
                        </span>
                      </div>

                      <div className="space-archives-window__record-meta">
                        {branchLabel ? (
                          <span className="space-archives-window__pill" title={branchLabel}>
                            {branchLabel}
                          </span>
                        ) : null}
                        {prLabel ? (
                          <span className="space-archives-window__pill" title={prLabel}>
                            PR {prLabel}
                          </span>
                        ) : null}
                        {summaryParts.length > 0 ? (
                          <span className="space-archives-window__record-counts">
                            {summaryParts.join(' · ')}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            </aside>

            <div className="space-archives-window__detail">
              {selectedRecord ? (
                <div className="space-archives-window__detail-body">
                  <SpaceArchiveReplayCanvas
                    record={selectedRecord}
                    canvasInputModeSetting={canvasInputModeSetting}
                  />
                </div>
              ) : null}
            </div>
          </div>
        )}

        {recordContextMenu ? (
          <ViewportMenuSurface
            open={true}
            className="workspace-context-menu space-archives-window__record-context-menu"
            placement={{
              type: 'point',
              point: {
                x: recordContextMenu.x,
                y: recordContextMenu.y,
              },
              estimatedSize: {
                width: 188,
                height: 56,
              },
            }}
            data-testid="space-archives-window-record-context-menu"
            onDismiss={() => {
              setRecordContextMenu(null)
            }}
            dismissOnPointerDownOutside={true}
            dismissOnEscape={true}
            style={{
              zIndex: 25,
            }}
          >
            <button
              type="button"
              data-testid="space-archives-window-record-delete"
              onClick={() => {
                onDeleteRecord(recordContextMenu.recordId)
                setRecordContextMenu(null)
              }}
            >
              <Trash2 className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('spaceArchivesWindow.contextMenu.delete')}
              </span>
            </button>
          </ViewportMenuSurface>
        ) : null}
      </section>
    </div>
  )
}
