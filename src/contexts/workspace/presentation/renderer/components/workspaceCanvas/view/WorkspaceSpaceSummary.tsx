import type { JSX } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import type { TerminalNodeData } from '../../../types'
import { NodeKindIcon } from '../../shared/NodeKindIcon'
import { resolveAgentPresentation } from '../../../utils/agentPresentation'
import { resolveAgentTreatedProvider } from '../../../utils/terminalAgentOverlay'
import { resolveSpaceSummaryStatus } from './spaceSummary'

export function WorkspaceSpaceSummary({
  spaceId,
  nodes,
  onRevealNode,
}: {
  spaceId: string
  nodes: Node<TerminalNodeData>[]
  onRevealNode: (nodeId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      id={`workspace-space-summary-${spaceId}`}
      className="workspace-space-region__summary nodrag nopan nowheel"
      data-testid={`workspace-space-summary-${spaceId}`}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="workspace-space-region__summary-count">
        {t('spaceCollapse.windows', { count: nodes.length })}
      </div>
      {nodes.length === 0 ? (
        <p className="workspace-space-region__summary-empty">{t('spaceCollapse.empty')}</p>
      ) : (
        <div className="workspace-space-region__summary-nodes">
          {nodes.map(node => {
            const agent = resolveAgentPresentation(node.data)
            const provider = agent.isAgent ? resolveAgentTreatedProvider(node) : null
            const status = resolveSpaceSummaryStatus(node.data, t)
            const title = [node.data.title, status?.label].filter(Boolean).join(' · ')
            return (
              <button
                key={node.id}
                type="button"
                className="workspace-space-region__summary-node"
                data-testid={`workspace-space-summary-node-${node.id}`}
                data-node-kind={agent.isAgent ? 'agent' : node.data.kind}
                data-node-status={status?.state}
                title={title}
                aria-label={t('spaceCollapse.revealWindow', {
                  name: node.data.title,
                  status: status?.label ?? '',
                })}
                onClick={event => {
                  event.stopPropagation()
                  onRevealNode(node.id)
                }}
              >
                <span className="workspace-space-region__summary-node-icon">
                  {provider ? (
                    <AgentProviderIcon provider={provider} />
                  ) : (
                    <NodeKindIcon kind={node.data.kind} />
                  )}
                  {status ? (
                    <span
                      className="workspace-space-region__summary-status-dot"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
                {status ? (
                  <span className="workspace-space-region__summary-node-status">
                    {status.label}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
