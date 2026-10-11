import { useEffect, useRef, useState, type JSX } from 'react'
import { Copy, GitMerge, RefreshCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export interface PluginCandidateInfo {
  id: string
  directory: string
  status: 'prepared' | 'conflict' | 'failed'
  error?: string
  stale?: 'installation' | 'source' | null
}

export function PluginCandidateList({
  candidates,
  busy,
  onApply,
  initialInstall = false,
}: {
  candidates: PluginCandidateInfo[]
  busy: boolean
  initialInstall?: boolean
  onApply: (id: string) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  async function copy(text: string): Promise<void> {
    try {
      await window.opencoveApi.clipboard.writeText(text)
      if (alive.current) {
        setFeedback(t('settingsPanel.plugins.tools.copied'))
      }
    } catch {
      if (alive.current) {
        setFeedback(t('settingsPanel.plugins.copyFailed'))
      }
    }
  }
  if (!candidates.length) {
    return null
  }
  return (
    <section className="settings-plugin-candidates" data-testid="settings-plugin-candidates">
      <h4>{t('settingsPanel.plugins.source.candidates')}</h4>
      <p>
        {t(
          `settingsPanel.plugins.source.${initialInstall ? 'installCandidateHelp' : 'candidateHelp'}`,
        )}
      </p>
      {candidates.map(candidate => (
        <article
          className="settings-plugin-candidate"
          key={candidate.id}
          data-testid={`settings-plugin-candidate-${candidate.id}`}
        >
          <div className="settings-plugin-candidate__heading">
            <GitMerge size={16} aria-hidden="true" />
            <strong>
              {t(
                `settingsPanel.plugins.source.${candidate.stale ? 'stale' : candidate.status === 'failed' ? 'candidateFailed' : candidate.status}`,
              )}
            </strong>
            <code>{candidate.id.slice(0, 8)}</code>
          </div>
          {candidate.error ? <p className="cove-window__error">{candidate.error}</p> : null}
          {candidate.stale ? <p>{t('settingsPanel.plugins.source.staleHelp')}</p> : null}
          <details>
            <summary>{t('settingsPanel.plugins.source.inspectCandidate')}</summary>
            <p>{t('settingsPanel.plugins.source.workerDirectory')}</p>
            <code className="settings-plugin-candidate__path">{candidate.directory}</code>
            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              onClick={() => void copy(candidate.directory)}
            >
              <Copy size={13} aria-hidden="true" />
              {t('settingsPanel.plugins.source.copyPath')}
            </button>
          </details>
          <div className="settings-plugin-runtime__actions">
            <button
              type="button"
              className="cove-window__action cove-window__action--secondary"
              disabled={busy || Boolean(candidate.stale)}
              onClick={() => onApply(candidate.id)}
              data-testid={`settings-plugin-candidate-apply-${candidate.id}`}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {t('settingsPanel.plugins.source.applyCandidate')}
            </button>
            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              onClick={() =>
                void copy(
                  t('settingsPanel.plugins.source.resolvePrompt', {
                    directory: candidate.directory,
                    candidate: candidate.id,
                  }),
                )
              }
            >
              <Copy size={13} aria-hidden="true" />
              {t('settingsPanel.plugins.source.copyResolution')}
            </button>
          </div>
        </article>
      ))}
      {feedback ? <p role="status">{feedback}</p> : null}
    </section>
  )
}
