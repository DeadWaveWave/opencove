import React from 'react'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { shouldStopWheelPropagation } from '../../../components/taskNode/helpers'
import type { SpaceExplorerRow } from './WorkspaceSpaceExplorerOverlay.model'

function renderRowDisclosure(row: Extract<SpaceExplorerRow, { kind: 'entry' }>): React.JSX.Element {
  if (row.entry.kind !== 'directory') {
    return <span className="workspace-space-explorer__entry-disclosure-placeholder" />
  }

  return row.isExpanded ? <ChevronDown /> : <ChevronRight />
}

export function WorkspaceSpaceExplorerTree({
  spaceId,
  isLoadingRoot,
  rootError,
  rows,
  selectedEntryUri,
  onRefresh,
  onEntryActivate,
}: {
  spaceId: string
  isLoadingRoot: boolean
  rootError: string | null
  rows: SpaceExplorerRow[]
  selectedEntryUri: string | null
  onRefresh: () => void
  onEntryActivate: (entry: Extract<SpaceExplorerRow, { kind: 'entry' }>['entry']) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  if (isLoadingRoot) {
    return <div className="workspace-space-explorer__state">{t('common.loading')}</div>
  }

  if (rootError) {
    return (
      <div className="workspace-space-explorer__state workspace-space-explorer__state--error">
        <div className="workspace-space-explorer__state-title">{t('common.error')}</div>
        <div className="workspace-space-explorer__state-message">{rootError}</div>
        <button
          type="button"
          className="workspace-space-explorer__state-action"
          onClick={event => {
            event.stopPropagation()
            onRefresh()
          }}
        >
          {t('documentNode.retry')}
        </button>
      </div>
    )
  }

  if (rows.length === 0) {
    return <div className="workspace-space-explorer__state">{t('spaceExplorer.empty')}</div>
  }

  return (
    <div
      className="workspace-space-explorer__tree"
      onWheel={event => {
        if (shouldStopWheelPropagation(event.currentTarget)) {
          event.stopPropagation()
        }
      }}
    >
      {rows.map(row => {
        if (row.kind === 'state') {
          return (
            <div
              key={row.id}
              className={
                row.stateKind === 'error'
                  ? 'workspace-space-explorer__tree-state workspace-space-explorer__tree-state--error'
                  : 'workspace-space-explorer__tree-state'
              }
              style={{ paddingLeft: `${16 + row.depth * 14}px` }}
            >
              {row.message}
            </div>
          )
        }

        return (
          <button
            key={row.entry.uri}
            type="button"
            className={
              selectedEntryUri === row.entry.uri
                ? 'workspace-space-explorer__entry workspace-space-explorer__entry--selected'
                : 'workspace-space-explorer__entry'
            }
            data-testid={`workspace-space-explorer-entry-${spaceId}-${encodeURIComponent(row.entry.uri)}`}
            title={row.entry.name}
            style={{ paddingLeft: `${10 + row.depth * 14}px` }}
            onClick={event => {
              event.stopPropagation()
              onEntryActivate(row.entry)
            }}
          >
            <span className="workspace-space-explorer__entry-disclosure" aria-hidden="true">
              {renderRowDisclosure(row)}
            </span>
            {row.entry.kind === 'directory' ? (
              <Folder className="workspace-space-explorer__entry-icon" aria-hidden="true" />
            ) : (
              <FileText className="workspace-space-explorer__entry-icon" aria-hidden="true" />
            )}
            <span className="workspace-space-explorer__entry-label">{row.entry.name}</span>
          </button>
        )
      })}
    </div>
  )
}
