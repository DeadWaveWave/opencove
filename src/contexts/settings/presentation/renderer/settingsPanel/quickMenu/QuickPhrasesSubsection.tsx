import React, { useCallback, useState } from 'react'
import { ChevronDown, ChevronUp, Power } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { QuickPhrase } from '@contexts/settings/domain/agentSettings'
import { moveItem } from './moveItem'

type QuickPhraseDraft = {
  id: string
  title: string
  content: string
  enabled: boolean
}

function toQuickPhraseDraft(phrase: QuickPhrase): QuickPhraseDraft {
  return {
    id: phrase.id,
    title: phrase.title,
    content: phrase.content,
    enabled: phrase.enabled,
  }
}

function fromQuickPhraseDraft(draft: QuickPhraseDraft): QuickPhrase | null {
  const title = draft.title.trim()
  const content = draft.content.trim()

  if (title.length === 0 || content.length === 0) {
    return null
  }

  return {
    id: draft.id,
    title,
    content,
    enabled: draft.enabled,
  }
}

export function QuickPhrasesSubsection({
  quickPhrases,
  onChangeQuickPhrases,
}: {
  quickPhrases: QuickPhrase[]
  onChangeQuickPhrases: (phrases: QuickPhrase[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const [phraseEditor, setPhraseEditor] = useState<{
    mode: 'create' | 'edit'
    draft: QuickPhraseDraft
    hasError: boolean
  } | null>(null)

  const openNewPhraseEditor = useCallback(() => {
    setPhraseEditor({
      mode: 'create',
      draft: {
        id: crypto.randomUUID(),
        title: '',
        content: '',
        enabled: true,
      },
      hasError: false,
    })
  }, [])

  const openEditPhraseEditor = useCallback((phrase: QuickPhrase) => {
    setPhraseEditor({
      mode: 'edit',
      draft: toQuickPhraseDraft(phrase),
      hasError: false,
    })
  }, [])

  const closePhraseEditor = useCallback(() => {
    setPhraseEditor(null)
  }, [])

  const savePhrase = useCallback(() => {
    if (!phraseEditor) {
      return
    }

    const resolved = fromQuickPhraseDraft(phraseEditor.draft)
    if (!resolved) {
      setPhraseEditor(previous => (previous ? { ...previous, hasError: true } : null))
      return
    }

    const next =
      phraseEditor.mode === 'create'
        ? [...quickPhrases, resolved]
        : quickPhrases.map(existing => (existing.id === resolved.id ? resolved : existing))

    onChangeQuickPhrases(next)
    closePhraseEditor()
  }, [closePhraseEditor, onChangeQuickPhrases, phraseEditor, quickPhrases])

  const canMovePhraseUp = useCallback((index: number) => index > 0, [])
  const canMovePhraseDown = useCallback(
    (index: number) => index < quickPhrases.length - 1,
    [quickPhrases.length],
  )

  return (
    <div className="settings-panel__subsection">
      <div className="settings-panel__subsection-header">
        <strong>{t('settingsPanel.quickMenu.phrases.title')}</strong>
        <span>{t('settingsPanel.quickMenu.phrases.help')}</span>
      </div>

      <div className="settings-list-container" data-testid="settings-quick-phrases-list">
        {quickPhrases.map((phrase, index) => (
          <div className="settings-list-item" key={phrase.id}>
            <div className="settings-list-item__left" style={{ cursor: 'default' }}>
              <span style={{ color: 'var(--cove-text)', fontWeight: 500 }}>{phrase.title}</span>
            </div>

            <div className="settings-agent-order__actions">
              <div
                className="settings-quick-menu__toggle"
                data-active={phrase.enabled ? 'true' : 'false'}
                title={t('settingsPanel.quickMenu.phrases.enabled')}
              >
                <Power className="settings-quick-menu__toggle-icon" aria-hidden="true" />
                <label className="cove-toggle">
                  <input
                    type="checkbox"
                    data-testid={`settings-quick-phrase-enabled-${phrase.id}`}
                    checked={phrase.enabled}
                    aria-label={t('settingsPanel.quickMenu.phrases.enabled')}
                    onChange={event => {
                      onChangeQuickPhrases(
                        quickPhrases.map(existing =>
                          existing.id === phrase.id
                            ? { ...existing, enabled: event.target.checked }
                            : existing,
                        ),
                      )
                    }}
                  />
                  <span className="cove-toggle__slider"></span>
                </label>
              </div>

              <button
                type="button"
                className="secondary settings-agent-order__action"
                data-testid={`settings-quick-phrase-move-up-${phrase.id}`}
                disabled={!canMovePhraseUp(index)}
                aria-label={t('settingsPanel.agent.moveUp')}
                onClick={() => onChangeQuickPhrases(moveItem(quickPhrases, index, index - 1))}
              >
                <ChevronUp className="settings-agent-order__icon" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="secondary settings-agent-order__action"
                data-testid={`settings-quick-phrase-move-down-${phrase.id}`}
                disabled={!canMovePhraseDown(index)}
                aria-label={t('settingsPanel.agent.moveDown')}
                onClick={() => onChangeQuickPhrases(moveItem(quickPhrases, index, index + 1))}
              >
                <ChevronDown className="settings-agent-order__icon" aria-hidden="true" />
              </button>

              <button
                type="button"
                className="secondary"
                data-testid={`settings-quick-phrase-edit-${phrase.id}`}
                onClick={() => openEditPhraseEditor(phrase)}
              >
                {t('settingsPanel.quickMenu.edit')}
              </button>
              <button
                type="button"
                className="secondary settings-list-item__remove"
                data-testid={`settings-quick-phrase-remove-${phrase.id}`}
                onClick={() => {
                  onChangeQuickPhrases(quickPhrases.filter(existing => existing.id !== phrase.id))
                }}
              >
                {t('common.remove')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="primary"
          data-testid="settings-quick-phrase-add"
          onClick={openNewPhraseEditor}
        >
          {t('settingsPanel.quickMenu.phrases.add')}
        </button>
      </div>

      {phraseEditor ? (
        <div
          className="cove-window-backdrop"
          data-testid="settings-quick-phrase-editor-backdrop"
          onClick={() => {
            closePhraseEditor()
          }}
        >
          <section
            className="cove-window"
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <h3>
              {phraseEditor.mode === 'create'
                ? t('settingsPanel.quickMenu.phrases.createTitle')
                : t('settingsPanel.quickMenu.phrases.editTitle')}
            </h3>
            <p className="cove-window__meta">{t('settingsPanel.quickMenu.phrases.editorHelp')}</p>

            <div className="cove-window__field-row">
              <label htmlFor="settings-quick-phrase-title">
                {t('settingsPanel.quickMenu.phrases.titleLabel')}
              </label>
              <input
                id="settings-quick-phrase-title"
                value={phraseEditor.draft.title}
                placeholder={t('settingsPanel.quickMenu.phrases.titlePlaceholder')}
                onChange={event => {
                  const value = event.target.value
                  setPhraseEditor(previous =>
                    previous
                      ? {
                          ...previous,
                          draft: { ...previous.draft, title: value },
                          hasError: false,
                        }
                      : null,
                  )
                }}
              />
            </div>

            <div className="cove-window__field-row">
              <label htmlFor="settings-quick-phrase-content">
                {t('settingsPanel.quickMenu.phrases.contentLabel')}
              </label>
              <textarea
                id="settings-quick-phrase-content"
                value={phraseEditor.draft.content}
                placeholder={t('settingsPanel.quickMenu.phrases.contentPlaceholder')}
                onChange={event => {
                  const value = event.target.value
                  setPhraseEditor(previous =>
                    previous
                      ? {
                          ...previous,
                          draft: { ...previous.draft, content: value },
                          hasError: false,
                        }
                      : null,
                  )
                }}
              />
            </div>

            <div className="cove-window__field-row">
              <label>{t('settingsPanel.quickMenu.phrases.enabled')}</label>
              <label className="cove-toggle">
                <input
                  type="checkbox"
                  checked={phraseEditor.draft.enabled}
                  onChange={event => {
                    setPhraseEditor(previous =>
                      previous
                        ? {
                            ...previous,
                            draft: { ...previous.draft, enabled: event.target.checked },
                            hasError: false,
                          }
                        : null,
                    )
                  }}
                />
                <span className="cove-toggle__slider"></span>
              </label>
            </div>

            {phraseEditor.hasError ? (
              <p className="cove-window__error">{t('settingsPanel.quickMenu.invalidForm')}</p>
            ) : null}

            <div className="cove-window__actions">
              <button
                type="button"
                className="cove-window__action cove-window__action--ghost"
                onClick={() => {
                  closePhraseEditor()
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="cove-window__action cove-window__action--primary"
                onClick={() => {
                  savePhrase()
                }}
              >
                {t('common.save')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
