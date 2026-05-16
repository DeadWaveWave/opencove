import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { SpaceArchiveRecord } from '@contexts/workspace/presentation/renderer/types'
import { getSpaceArchiveRecordSpaces } from '@contexts/workspace/presentation/renderer/utils/spaceArchiveRecords'

function toShortSha(value: string): string {
  return value.trim().slice(0, 7)
}

export function SpaceArchiveReplaySpaceRegion({
  record,
}: {
  record: SpaceArchiveRecord
}): React.JSX.Element | null {
  const { t } = useTranslation()

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
  const spaces = getSpaceArchiveRecordSpaces(record).filter(space => space.rect)
  if (spaces.length === 0) {
    return null
  }

  return (
    <>
      {spaces.map(space => {
        if (!space.rect) {
          return null
        }

        const isTargetSpace = space.id === record.space.id

        return (
          <div
            key={space.id}
            className="workspace-space-region workspace-space-region--selected space-archive-replay__space"
            data-cove-label-color={space.labelColor ?? undefined}
            style={{
              transform: `translate(${space.rect.x}px, ${space.rect.y}px)`,
              width: space.rect.width,
              height: space.rect.height,
            }}
            data-testid="space-archives-window-replay-space"
            data-space-id={space.id}
          >
            <div className="workspace-space-region__label-group space-archive-replay__space-label-group">
              <span className="workspace-space-region__label">
                {space.labelColor ? (
                  <span
                    className="cove-label-dot cove-label-dot--solid"
                    data-cove-label-color={space.labelColor}
                    aria-hidden="true"
                  />
                ) : null}
                {space.name}
              </span>

              {isTargetSpace && branchBadge ? (
                <span className="workspace-space-region__branch-badge" title={branchBadge.title}>
                  <span className="workspace-space-region__branch-badge-kind">
                    {branchBadge.kind}
                  </span>
                  <span className="workspace-space-region__branch-badge-value">
                    {branchBadge.value}
                  </span>
                </span>
              ) : null}

              {isTargetSpace && pullRequestUrl && pullRequest ? (
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
      })}
    </>
  )
}
