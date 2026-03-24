import React from 'react'
import { FileText, SquareDashed, StickyNote } from 'lucide-react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { LabelColor } from '@shared/types/labelColor'
import type { WorkspaceSearchHit } from '../utils/workspaceSearch'

export type WorkspaceSearchPill =
  | {
      kind: 'space'
      value: string
      color: LabelColor | null
    }
  | {
      kind: 'branch'
      label: string
      value: string
      title?: string
    }
  | {
      kind: 'pr'
      label: string
      value: string
      title?: string
    }

export type WorkspaceSearchItem = {
  id: string
  title: string
  subtitle?: string
  icon: React.JSX.Element
  labelColor: LabelColor | null
  pills: WorkspaceSearchPill[]
  onSelect: () => void
}

export type WorkspaceSearchSection = {
  id: string
  label: string
  items: WorkspaceSearchItem[]
}

export function flattenWorkspaceSearchSections(
  sections: WorkspaceSearchSection[],
): WorkspaceSearchItem[] {
  return sections.flatMap(section => section.items)
}

export function toWorkspaceSearchSections({
  hits,
  t,
  onSelectNode,
  onSelectSpace,
}: {
  hits: WorkspaceSearchHit[]
  t: TranslateFn
  onSelectNode: (nodeId: string) => void
  onSelectSpace: (spaceId: string) => void
}): WorkspaceSearchSection[] {
  const spaceHits = hits.filter(hit => hit.kind === 'space')
  const taskHits = hits.filter(hit => hit.kind === 'task')
  const noteHits = hits.filter(hit => hit.kind === 'note')

  const sections: WorkspaceSearchSection[] = []

  if (spaceHits.length > 0) {
    sections.push({
      id: 'spaces',
      label: t('workspaceSearch.sections.spaces'),
      items: spaceHits.map(hit => ({
        id: hit.id,
        title: hit.title,
        subtitle: hit.subtitle,
        icon: <SquareDashed aria-hidden="true" size={16} />,
        labelColor: hit.effectiveLabelColor,
        pills: [
          ...(hit.context.space && !hit.context.branch
            ? [
                {
                  kind: 'space',
                  value: hit.context.space.name,
                  color: hit.context.space.labelColor,
                } satisfies WorkspaceSearchPill,
              ]
            : []),
          ...(hit.context.branch
            ? [
                {
                  kind: 'branch',
                  label: hit.context.branch.head ? t('worktree.detached') : t('worktree.branch'),
                  value: hit.context.branch.head
                    ? toShortSha(hit.context.branch.head)
                    : hit.context.branch.name,
                  title: hit.context.branch.name,
                } satisfies WorkspaceSearchPill,
              ]
            : []),
          ...(hit.context.pullRequest
            ? [
                {
                  kind: 'pr',
                  label: 'PR',
                  value: `#${hit.context.pullRequest.number}`,
                  title: `${hit.context.pullRequest.title} (#${hit.context.pullRequest.number})`,
                } satisfies WorkspaceSearchPill,
              ]
            : []),
        ],
        onSelect: () => {
          if (!hit.spaceId) {
            return
          }

          onSelectSpace(hit.spaceId)
        },
      })),
    })
  }

  if (taskHits.length > 0) {
    sections.push({
      id: 'tasks',
      label: t('workspaceSearch.sections.tasks'),
      items: taskHits.map(hit => ({
        id: hit.id,
        title: hit.title,
        subtitle: hit.subtitle,
        icon: <FileText aria-hidden="true" size={16} />,
        labelColor: hit.effectiveLabelColor,
        pills: [
          ...(hit.context.space && !hit.context.branch
            ? [
                {
                  kind: 'space',
                  value: hit.context.space.name,
                  color: hit.context.space.labelColor,
                } satisfies WorkspaceSearchPill,
              ]
            : []),
          ...(hit.context.branch
            ? [
                {
                  kind: 'branch',
                  label: hit.context.branch.head ? t('worktree.detached') : t('worktree.branch'),
                  value: hit.context.branch.head
                    ? toShortSha(hit.context.branch.head)
                    : hit.context.branch.name,
                  title: hit.context.branch.name,
                } satisfies WorkspaceSearchPill,
              ]
            : []),
          ...(hit.context.pullRequest
            ? [
                {
                  kind: 'pr',
                  label: 'PR',
                  value: `#${hit.context.pullRequest.number}`,
                  title: `${hit.context.pullRequest.title} (#${hit.context.pullRequest.number})`,
                } satisfies WorkspaceSearchPill,
              ]
            : []),
        ],
        onSelect: () => {
          if (!hit.nodeId) {
            return
          }

          onSelectNode(hit.nodeId)
        },
      })),
    })
  }

  if (noteHits.length > 0) {
    sections.push({
      id: 'notes',
      label: t('workspaceSearch.sections.notes'),
      items: noteHits.map(hit => ({
        id: hit.id,
        title: hit.title,
        subtitle: hit.subtitle,
        icon: <StickyNote aria-hidden="true" size={16} />,
        labelColor: hit.effectiveLabelColor,
        pills: [
          ...(hit.context.space && !hit.context.branch
            ? [
                {
                  kind: 'space',
                  value: hit.context.space.name,
                  color: hit.context.space.labelColor,
                } satisfies WorkspaceSearchPill,
              ]
            : []),
          ...(hit.context.branch
            ? [
                {
                  kind: 'branch',
                  label: hit.context.branch.head ? t('worktree.detached') : t('worktree.branch'),
                  value: hit.context.branch.head
                    ? toShortSha(hit.context.branch.head)
                    : hit.context.branch.name,
                  title: hit.context.branch.name,
                } satisfies WorkspaceSearchPill,
              ]
            : []),
          ...(hit.context.pullRequest
            ? [
                {
                  kind: 'pr',
                  label: 'PR',
                  value: `#${hit.context.pullRequest.number}`,
                  title: `${hit.context.pullRequest.title} (#${hit.context.pullRequest.number})`,
                } satisfies WorkspaceSearchPill,
              ]
            : []),
        ],
        onSelect: () => {
          if (!hit.nodeId) {
            return
          }

          onSelectNode(hit.nodeId)
        },
      })),
    })
  }

  return sections
}

function toShortSha(value: string): string {
  return value.trim().slice(0, 7)
}
