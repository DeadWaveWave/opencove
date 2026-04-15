import React, { useEffect, useMemo, useRef, type JSX } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Search, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

function isFindShortcut(event: React.KeyboardEvent<HTMLInputElement>): boolean {
  if (event.altKey) {
    return false
  }

  if (!(event.metaKey || event.ctrlKey)) {
    return false
  }

  return event.key.toLowerCase() === 'f'
}

function formatMatchCount(resultIndex: number, resultCount: number): string {
  if (!Number.isFinite(resultIndex) || !Number.isFinite(resultCount) || resultCount <= 0) {
    return '0 / 0'
  }

  if (resultIndex < 0) {
    return `— / ${resultCount}`
  }

  return `${Math.min(resultIndex + 1, resultCount)} / ${resultCount}`
}

export function TerminalNodeFindBar({
  isOpen,
  query,
  resultIndex,
  resultCount,
  caseSensitive,
  useRegex,
  onQueryChange,
  onFindNext,
  onFindPrevious,
  onClose,
  onToggleCaseSensitive,
  onToggleUseRegex,
}: {
  isOpen: boolean
  query: string
  resultIndex: number
  resultCount: number
  caseSensitive: boolean
  useRegex: boolean
  onQueryChange: (query: string) => void
  onFindNext: () => void
  onFindPrevious: () => void
  onClose: () => void
  onToggleCaseSensitive: () => void
  onToggleUseRegex: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [isOpen])

  const matchCountLabel = useMemo(
    () => formatMatchCount(resultIndex, resultCount),
    [resultCount, resultIndex],
  )

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="terminal-node__find nodrag"
      data-cove-focus-scope="terminal"
      data-testid="terminal-find"
    >
      <Search aria-hidden="true" size={14} className="terminal-node__find-icon" />
      <input
        ref={inputRef}
        className="terminal-node__find-input nowheel"
        value={query}
        placeholder={t('terminalFind.placeholder')}
        data-testid="terminal-find-input"
        onChange={event => {
          onQueryChange(event.target.value)
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            return
          }

          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            if (event.shiftKey) {
              onFindPrevious()
            } else {
              onFindNext()
            }
            return
          }

          if (isFindShortcut(event)) {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.select()
          }
        }}
      />

      <div className="terminal-node__find-toggles">
        <button
          type="button"
          className={`terminal-node__find-toggle${caseSensitive ? ' terminal-node__find-toggle--active' : ''}`}
          data-testid="terminal-find-case-sensitive"
          aria-label={t('terminalFind.caseSensitive')}
          title={t('terminalFind.caseSensitive')}
          aria-pressed={caseSensitive}
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onToggleCaseSensitive()
          }}
        >
          <CaseSensitive size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`terminal-node__find-toggle${useRegex ? ' terminal-node__find-toggle--active' : ''}`}
          data-testid="terminal-find-use-regex"
          aria-label={t('terminalFind.useRegex')}
          title={t('terminalFind.useRegex')}
          aria-pressed={useRegex}
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onToggleUseRegex()
          }}
        >
          <Regex size={14} aria-hidden="true" />
        </button>
      </div>

      <span className="terminal-node__find-count" aria-hidden="true">
        {matchCountLabel}
      </span>

      <div className="terminal-node__find-actions">
        <button
          type="button"
          className="terminal-node__find-action"
          data-testid="terminal-find-prev"
          aria-label={t('terminalFind.previous')}
          title={t('terminalFind.previous')}
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onFindPrevious()
          }}
        >
          <ChevronUp size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="terminal-node__find-action"
          data-testid="terminal-find-next"
          aria-label={t('terminalFind.next')}
          title={t('terminalFind.next')}
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onFindNext()
          }}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="terminal-node__find-action"
          data-testid="terminal-find-close"
          aria-label={t('terminalFind.close')}
          title={t('terminalFind.close')}
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
