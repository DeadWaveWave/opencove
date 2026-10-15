import { Play } from 'lucide-react'
import { NodeKindIcon } from './shared/NodeKindIcon'
import { WindowHeader } from './shared/WindowHeader'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Handle, Position } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { NodeFrame, Point, RoleNodeData } from '../types'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'
import { shouldStopWheelPropagation } from './taskNode/helpers'

interface RoleNodeInteractionOptions {
  normalizeViewport?: boolean
  selectNode?: boolean
  shiftKey?: boolean
}

interface RoleNodeProps {
  title: string
  role: RoleNodeData
  position: Point
  width: number
  height: number
  providerOptions: AgentProvider[]
  selectedProvider: AgentProvider
  lastError: string | null
  onClose: () => void
  onProviderChange: (provider: AgentProvider) => void
  onInputSave: (input: string) => void
  onRun: (input: string) => void
  onResize: (frame: NodeFrame) => void
  onInteractionStart?: (options?: RoleNodeInteractionOptions) => void
}

export function RoleNode({
  title,
  role,
  position,
  width,
  height,
  providerOptions,
  selectedProvider,
  lastError,
  onClose,
  onProviderChange,
  onInputSave,
  onRun,
  onResize,
  onInteractionStart,
}: RoleNodeProps): JSX.Element {
  const { t } = useTranslation()
  const [inputDraft, setInputDraft] = useState(role.input)
  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: resolveCanonicalNodeMinSize('role'),
    onResize,
  })

  useEffect(() => {
    setInputDraft(role.input)
  }, [role.input])

  const commitInput = useCallback(() => {
    if (inputDraft !== role.input) {
      onInputSave(inputDraft)
    }
  }, [inputDraft, onInputSave, role.input])

  const renderedFrame = draftFrame ?? {
    position,
    size: { width, height },
  }
  const style = useMemo(
    () => ({
      width: renderedFrame.size.width,
      height: renderedFrame.size.height,
      transform:
        renderedFrame.position.x !== position.x || renderedFrame.position.y !== position.y
          ? `translate(${renderedFrame.position.x - position.x}px, ${renderedFrame.position.y - position.y}px)`
          : undefined,
    }),
    [
      position.x,
      position.y,
      renderedFrame.position.x,
      renderedFrame.position.y,
      renderedFrame.size.height,
      renderedFrame.size.width,
    ],
  )

  const latestRun = role.runHistory[0] ?? null

  return (
    <div
      className="role-node nowheel"
      data-cove-part="window"
      data-cove-kind="role"
      style={style}
      data-testid="role-node"
      onClickCapture={event => {
        if (event.button !== 0 || !(event.target instanceof Element)) {
          return
        }

        if (event.target.closest('.role-node__input')) {
          event.stopPropagation()
          onInteractionStart?.({
            normalizeViewport: true,
            selectNode: false,
            shiftKey: event.shiftKey,
          })
          return
        }

        if (event.target.closest('.nodrag, button, input, textarea, select, a')) {
          return
        }

        event.stopPropagation()
        onInteractionStart?.({ shiftKey: event.shiftKey })
      }}
      onWheel={event => {
        if (shouldStopWheelPropagation(event.currentTarget)) {
          event.stopPropagation()
        }
      }}
    >
      <Handle type="target" position={Position.Left} className="workspace-node-handle" />
      <Handle type="source" position={Position.Right} className="workspace-node-handle" />
      <WindowHeader
        className="role-node__header"
        icon={<NodeKindIcon kind="role" />}
        title={
          <span
            className="role-node__title"
            data-cove-part="window-title"
            data-testid="role-node-title"
          >
            {title.trim().length > 0 ? title : role.roleName}
          </span>
        }
        status={<span className="role-node__meta">{AGENT_PROVIDER_LABEL[selectedProvider]}</span>}
        close={{ label: t('roleNode.deleteRoleNode'), className: 'role-node__close', onClose }}
      />

      {role.roleDescription.trim().length > 0 ? (
        <p className="role-node__description">{role.roleDescription}</p>
      ) : null}

      <label className="role-node__field role-node__field--compact">
        <span>{t('roleNode.agent')}</span>
        <select
          className="role-node__provider nodrag"
          data-testid="role-node-provider"
          value={selectedProvider}
          onPointerDownCapture={event => {
            event.stopPropagation()
          }}
          onClick={event => {
            event.stopPropagation()
          }}
          onChange={event => {
            onProviderChange(event.target.value as AgentProvider)
          }}
        >
          {providerOptions.map(provider => (
            <option key={provider} value={provider}>
              {AGENT_PROVIDER_LABEL[provider]}
            </option>
          ))}
        </select>
      </label>

      <label className="role-node__field">
        <span>{t('roleNode.input')}</span>
        <textarea
          className="role-node__input nodrag nowheel"
          data-testid="role-node-input"
          value={inputDraft}
          placeholder={role.inputHint.trim().length > 0 ? role.inputHint : t('roleNode.inputHint')}
          onPointerDownCapture={event => {
            event.stopPropagation()
          }}
          onClick={event => {
            event.stopPropagation()
          }}
          onBlur={commitInput}
          onChange={event => {
            setInputDraft(event.target.value)
          }}
        />
      </label>

      {lastError ? <div className="role-node__error">{lastError}</div> : null}

      <div className="role-node__footer">
        <button
          type="button"
          className="role-node__run nodrag"
          data-testid="role-node-run"
          onClick={event => {
            event.stopPropagation()
            commitInput()
            onRun(inputDraft)
          }}
        >
          <Play aria-hidden="true" />
          <span>{t('roleNode.run')}</span>
        </button>
        <div className="role-node__history">
          {latestRun
            ? t('roleNode.lastRun', { timestamp: new Date(latestRun.createdAt).toLocaleString() })
            : t('roleNode.noRuns')}
        </div>
      </div>

      <NodeResizeHandles
        classNamePrefix="role-node"
        testIdPrefix="role-node-resize"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
