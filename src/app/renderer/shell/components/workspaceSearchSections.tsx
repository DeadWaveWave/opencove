import React from 'react'
import { FileText, Scan, StickyNote } from 'lucide-react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { LabelColor } from '@shared/types/labelColor'
import type { WorkspaceSearchHit } from '../utils/workspaceSearch'

export type WorkspaceSearchMetadata = {
  kind: 'space' | 'branch' | 'pr'
  value: string
  title?: string
}

export type WorkspaceSearchItem = {
  id: string
  title: string
  subtitle?: string
  icon: React.JSX.Element
  labelColor: LabelColor | null
  metadata: WorkspaceSearchMetadata[]
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

function resolveMetadata(hit: WorkspaceSearchHit, t: TranslateFn): WorkspaceSearchMetadata[] {
  const { space, branch, pullRequest } = hit.context
  const metadata: WorkspaceSearchMetadata[] = []
  if (space && !branch && hit.kind !== 'space') {
    metadata.push({ kind: 'space', value: space.name })
  }
  if (branch) {
    metadata.push({
      kind: 'branch',
      value: branch.head ? branch.head.trim().slice(0, 7) : branch.name,
      title: branch.head ? `${t('worktree.detached')}: ${branch.name}` : branch.name,
    })
  }
  if (pullRequest) {
    metadata.push({
      kind: 'pr',
      value: `#${pullRequest.number}`,
      title: `${pullRequest.title} (#${pullRequest.number})`,
    })
  }
  return metadata
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
  const categories = [
    { kind: 'space', id: 'spaces', label: t('workspaceSearch.sections.spaces'), Icon: Scan },
    { kind: 'task', id: 'tasks', label: t('workspaceSearch.sections.tasks'), Icon: FileText },
    { kind: 'note', id: 'notes', label: t('workspaceSearch.sections.notes'), Icon: StickyNote },
  ] as const

  return categories.flatMap(({ kind, id, label, Icon }) => {
    const items = hits
      .filter(hit => hit.kind === kind)
      .map(hit => ({
        id: hit.id,
        title: hit.title,
        subtitle: hit.kind === 'space' ? undefined : hit.subtitle,
        icon: <Icon aria-hidden="true" size={16} />,
        labelColor: hit.effectiveLabelColor,
        metadata: resolveMetadata(hit, t),
        onSelect: () => {
          if (hit.kind === 'space' && hit.spaceId) {
            onSelectSpace(hit.spaceId)
          } else if (hit.nodeId) {
            onSelectNode(hit.nodeId)
          }
        },
      }))
    return items.length > 0 ? [{ id, label, items }] : []
  })
}
