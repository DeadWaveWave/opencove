import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { useSystemFonts } from '@app/renderer/shell/hooks/useSystemFonts'

export function TerminalFontFamilyRow({
  terminalFontFamily,
  onChangeTerminalFontFamily,
}: {
  terminalFontFamily: string | null
  onChangeTerminalFontFamily: (family: string | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { fonts, isLoading } = useSystemFonts()
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const visibleFonts = fonts.filter(f => {
    if (!showAll && !f.monospace) {
      return false
    }
    if (query.trim().length > 0) {
      return f.name.toLowerCase().includes(query.trim().toLowerCase())
    }
    return true
  })

  const displayValue = terminalFontFamily ?? t('settingsPanel.general.terminalFontFamilyDefault')

  const open = useCallback(() => {
    setIsOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
  }, [])

  const select = useCallback(
    (name: string | null) => {
      onChangeTerminalFontFamily(name)
      close()
    },
    [onChangeTerminalFontFamily, close],
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, close])

  return (
    <div className="settings-panel__row">
      <div className="settings-panel__row-label">
        <strong>{t('settingsPanel.general.terminalFontFamily')}</strong>
      </div>
      <div
        className="settings-panel__control"
        style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}
      >
        <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
          <button
            type="button"
            className="cove-field cove-select__trigger"
            style={{ width: '100%' }}
            onClick={() => (isOpen ? close() : open())}
            id="settings-terminal-font-family"
            data-testid="settings-terminal-font-family"
          >
            <span className="cove-select__label">
              {isLoading ? t('settingsPanel.general.terminalFontFamilyLoading') : displayValue}
            </span>
            <ChevronDown
              aria-hidden="true"
              size={16}
              className={`cove-select__chevron${isOpen ? ' cove-select__chevron--open' : ''}`}
            />
          </button>

          {isOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 140,
                background: 'color-mix(in srgb, var(--cove-surface-strong) 88%, transparent)',
                backdropFilter: 'blur(18px) saturate(130%)',
                border: '1px solid var(--cove-border)',
                borderRadius: 12,
                boxShadow: '0 22px 48px var(--cove-shadow-color-elevated)',
                marginTop: 4,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                padding: 6,
              }}
            >
              <div style={{ padding: '8px 8px 4px' }}>
                <input
                  ref={inputRef}
                  type="text"
                  className="cove-field"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder={t('settingsPanel.general.terminalFontFamilySearch')}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
              <div
                style={{ padding: '2px 8px 6px', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <input
                  type="checkbox"
                  id="font-show-all"
                  checked={showAll}
                  onChange={e => setShowAll(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label
                  htmlFor="font-show-all"
                  style={{ fontSize: 12, color: 'var(--cove-text-muted)', cursor: 'pointer' }}
                >
                  {t('settingsPanel.general.terminalFontFamilyShowAll')}
                </label>
              </div>
              <ul
                ref={listRef}
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: '4px 0',
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                <li>
                  <button
                    type="button"
                    className={`cove-select__option${terminalFontFamily === null ? ' cove-select__option--selected' : ''}`}
                    onClick={() => select(null)}
                  >
                    {t('settingsPanel.general.terminalFontFamilyDefault')}
                  </button>
                </li>
                {visibleFonts.map(font => (
                  <li key={font.name}>
                    <button
                      type="button"
                      className={`cove-select__option${terminalFontFamily === font.name ? ' cove-select__option--selected' : ''}`}
                      style={{ fontFamily: font.name }}
                      onClick={() => select(font.name)}
                    >
                      {font.name}
                    </button>
                  </li>
                ))}
                {!isLoading && visibleFonts.length === 0 && (
                  <li
                    style={{ padding: '6px 12px', color: 'var(--cove-text-muted)', fontSize: 13 }}
                  >
                    {t('settingsPanel.general.terminalFontFamilyNoResults')}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
