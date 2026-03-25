import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { SpaceArchiveRecord } from '@contexts/workspace/presentation/renderer/types'

function toShortSha(value: string): string {
  return value.trim().slice(0, 7)
}

export function SpaceArchiveReplaySpaceRegion({
  record,
}: {
  record: SpaceArchiveRecord
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!record.space.rect) {
    return null
  }

  const branchBadge = record.git?.branch
    ? {
        kind: t('worktree.branch'),
        value: record.git.branch,
        title: record.git.branch,
      }
    : record.git?.head
      ? {
          kind: t('worktree.detached'),
          value: toShortSha(record.git.head),
          title: record.git.head,
        }
      : null

  const pullRequest = record.git?.pullRequest ?? null
  const pullRequestUrl = pullRequest?.ref.url ?? null

  return (
    <div
      className="workspace-space-region workspace-space-region--selected space-archive-replay__space"
      data-cove-label-color={record.space.labelColor ?? undefined}
      style={{
        transform: `translate(${record.space.rect.x}px, ${record.space.rect.y}px)`,
        width: record.space.rect.width,
        height: record.space.rect.height,
      }}
      data-testid="space-archives-window-replay-space"
    >
      <div className="workspace-space-region__label-group space-archive-replay__space-label-group">
        <span className="workspace-space-region__label">
          {record.space.labelColor ? (
            <span
              className="cove-label-dot cove-label-dot--solid"
              data-cove-label-color={record.space.labelColor}
              aria-hidden="true"
            />
          ) : null}
          {record.space.name}
        </span>

        {branchBadge ? (
          <span className="workspace-space-region__branch-badge" title={branchBadge.title}>
            <span className="workspace-space-region__branch-badge-kind">{branchBadge.kind}</span>
            <span className="workspace-space-region__branch-badge-value">{branchBadge.value}</span>
          </span>
        ) : null}

        {pullRequestUrl && pullRequest ? (
          <a
            className="workspace-space-region__pr-chip"
            href={pullRequestUrl}
            target="_blank"
            rel="noreferrer"
            title={`${pullRequest.title} (#${pullRequest.number})`}
            onPointerDown={event => {
              event.stopPropagation()
            }}
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <span className="workspace-space-region__pr-chip-kind">PR</span>
            <span className="workspace-space-region__pr-chip-value">{`#${pullRequest.number}`}</span>
          </a>
        ) : null}
      </div>
    </div>
  )
}
