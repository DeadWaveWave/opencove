import React, { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AudioLines, Copy, ExternalLink, FileText, FolderOpen, Image, Video } from 'lucide-react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalLinkIntent } from './linkHostEvent'
import type { DocumentNodeMediaKind } from '../../DocumentNode.media'

const ACTION_ICONS = {
  url: ExternalLink,
  directory: FolderOpen,
  file: FileText,
  image: Image,
  audio: AudioLines,
  video: Video,
}

export function TerminalLinkSurface({
  intent,
  container,
  destination,
  kind,
  primaryLabel,
  message,
  disabled,
  systemAlternate,
  onOpen,
  onCopy,
}: {
  intent: TerminalLinkIntent
  container: HTMLDivElement | null
  destination: string
  kind: 'url' | 'file' | 'directory' | DocumentNodeMediaKind
  primaryLabel: string
  message: string | null
  disabled: boolean
  systemAlternate: boolean
  onOpen: (system?: boolean) => void
  onCopy: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const isMac = /mac/i.test(navigator.platform)
  const modifier = isMac ? '⌘' : 'Ctrl'
  const placement = useMemo(
    () => ({
      type: 'point' as const,
      point: { x: intent.clientX, y: intent.clientY },
      alignX: 'start' as const,
      alignY: 'end' as const,
      flipY: true,
      gapY: 6,
      padding: 8,
      estimatedSize: { width: 256, height: 96 },
    }),
    [intent.clientX, intent.clientY],
  )
  if (intent.action === 'hover') {
    const parent = container?.closest('.terminal-node') ?? container
    return parent
      ? createPortal(
          <div className="terminal-link-status" role="tooltip" title={destination}>
            {destination} · {t('terminalLink.hint', { modifier })}
          </div>,
          parent,
        )
      : null
  }
  const Icon = ACTION_ICONS[kind]
  const shortcut = (alternate = false) => (
    <span className="terminal-link-card__shortcut" aria-hidden="true">
      {alternate ? <kbd>{isMac ? '⇧' : 'Shift'}</kbd> : null}
      <kbd>{modifier}</kbd>
      <kbd>{t('terminalLink.click')}</kbd>
    </span>
  )
  return (
    <ViewportMenuSurface
      open
      placement={placement}
      waitForMeasurement
      className="workspace-context-menu terminal-link-card"
      role="dialog"
      aria-label={t('terminalLink.actions')}
      data-testid="terminal-link-actions"
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
          return
        }
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        ]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const direction = event.key === 'ArrowDown' ? 1 : -1
        buttons[(index + direction + buttons.length) % buttons.length]?.focus()
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="terminal-link-card__header">
        <span className="terminal-link-card__target" title={destination}>
          {destination}
        </span>
        <button
          type="button"
          className="terminal-link-card__copy"
          title={t('terminalLink.copy')}
          aria-label={t('terminalLink.copy')}
          onClick={onCopy}
        >
          <Copy size={13} aria-hidden="true" />
        </button>
      </div>
      {message ? (
        <div role="status" className="terminal-link-card__hint">
          {message}
        </div>
      ) : null}
      <button
        type="button"
        className="terminal-link-card__action"
        data-terminal-link-primary
        disabled={disabled}
        onClick={() => onOpen()}
      >
        <Icon size={14} aria-hidden="true" />
        <span>{primaryLabel}</span>
        {shortcut()}
      </button>
      {systemAlternate ? (
        <button
          type="button"
          className="terminal-link-card__action"
          disabled={disabled}
          onClick={() => onOpen(true)}
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span>{t('terminalLink.openWithDefaultApp')}</span>
          {shortcut(true)}
        </button>
      ) : null}
    </ViewportMenuSurface>
  )
}
