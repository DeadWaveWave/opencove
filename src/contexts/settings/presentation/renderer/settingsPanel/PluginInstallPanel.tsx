import { useRef, useEffect, useState, type FormEvent, type JSX } from 'react'
import { ArrowRight, Search, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { changeInstalledPlugin } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { pluginErrorMessage } from '@contexts/plugins/presentation/renderer/pluginErrorMessage'

interface Repository {
  name: string
  url: string
  description: string | null
  stars: number
}

/** Installation is an explicit command; discovery only selects an input. */
export function PluginInstallPanel({
  onCancel,
  onInstalled,
}: {
  onCancel: () => void
  onInstalled: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'local' | 'git' | 'discover'>('git')
  const [source, setSource] = useState('')
  const [ref, setRef] = useState('')
  const [directory, setDirectory] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Repository[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'discover') {
        const result = await window.opencoveApi.controlSurface.invoke<{
          repositories: Repository[]
        }>({ kind: 'query', id: 'plugin.discover', payload: { query: query.trim() } })
        if (alive.current) {
          setResults(result.repositories)
        }
      } else {
        const result = await changeInstalledPlugin<{
          status?: string
          error?: string
          candidateDirectory?: string
        }>(
          mode === 'local' ? 'plugin.install' : 'plugin.git.install',
          mode === 'local'
            ? { directory: source.trim() }
            : {
                repository: source.trim(),
                ...(ref.trim() ? { ref: ref.trim() } : {}),
                ...(directory.trim() ? { directory: directory.trim() } : {}),
                build: { kind: 'none' },
              },
        )
        if (mode === 'git' && result?.status !== 'installed') {
          throw new Error(
            [result?.error, result?.candidateDirectory].filter(Boolean).join('\n') ||
              t('settingsPanel.plugins.install.failed'),
          )
        }
        if (alive.current) {
          onInstalled()
        }
      }
    } catch (cause) {
      if (alive.current) {
        setError(pluginErrorMessage(cause))
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }
  return (
    <section
      className="settings-plugin-install"
      aria-label={t('settingsPanel.plugins.install.title')}
      data-testid="settings-plugin-install-panel"
    >
      <div className="settings-plugin-install__heading">
        <h3>{t('settingsPanel.plugins.install.title')}</h3>
        <button
          type="button"
          className="cove-window__action cove-window__action--ghost"
          onClick={onCancel}
          disabled={busy}
          aria-label={t('settingsPanel.plugins.install.close')}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div
        className="settings-plugin-install__modes"
        role="group"
        aria-label={t('settingsPanel.plugins.install.source')}
      >
        {(['git', 'local', 'discover'] as const).map(value => (
          <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            disabled={busy}
            onClick={() => {
              setMode(value)
              setSource('')
              setError(null)
            }}
          >
            {t(`settingsPanel.plugins.install.${value}`)}
          </button>
        ))}
      </div>
      <form onSubmit={event => void submit(event)}>
        {mode === 'discover' ? (
          <>
            <label>
              {t('settingsPanel.plugins.install.searchLabel')}
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                disabled={busy}
                data-testid="settings-plugin-discover-query"
              />
            </label>
            <p>{t('settingsPanel.plugins.install.discoveryHelp')}</p>
          </>
        ) : (
          <>
            <label>
              {t(`settingsPanel.plugins.install.${mode === 'git' ? 'repository' : 'directory'}`)}
              <input
                required
                value={source}
                onChange={event => setSource(event.target.value)}
                disabled={busy}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                data-testid="settings-plugin-install-source"
              />
            </label>
            {mode === 'git' ? (
              <details>
                <summary>{t('settingsPanel.plugins.install.options')}</summary>
                <div className="settings-plugin-install__options">
                  <label>
                    {t('settingsPanel.plugins.install.ref')}
                    <input
                      value={ref}
                      onChange={event => setRef(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    {t('settingsPanel.plugins.install.packageDirectory')}
                    <input
                      value={directory}
                      onChange={event => setDirectory(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                </div>
              </details>
            ) : null}
            <p>{t(`settingsPanel.plugins.install.${mode === 'git' ? 'gitHelp' : 'localHelp'}`)}</p>
          </>
        )}
        {error ? (
          <p className="cove-window__error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="cove-window__action cove-window__action--secondary"
          disabled={busy}
          data-testid="settings-plugin-install-submit"
        >
          {mode === 'discover' ? (
            <Search size={14} aria-hidden="true" />
          ) : (
            <ArrowRight size={14} aria-hidden="true" />
          )}
          {t(
            `settingsPanel.plugins.install.${busy ? 'working' : mode === 'discover' ? 'search' : 'confirm'}`,
          )}
        </button>
      </form>
      {mode === 'discover' && results ? (
        <div className="settings-plugin-discovery" aria-live="polite">
          {results.length === 0 ? (
            <p>{t('settingsPanel.plugins.install.noResults')}</p>
          ) : (
            results.map(repo => (
              <article key={repo.url}>
                <div>
                  <a href={repo.url} target="_blank" rel="noopener noreferrer">
                    {repo.name}
                  </a>
                  <p>{repo.description}</p>
                </div>
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  onClick={() => {
                    setSource(repo.url)
                    setMode('git')
                    setError(null)
                  }}
                >
                  {t('settingsPanel.plugins.install.choose')}
                </button>
              </article>
            ))
          )}
        </div>
      ) : null}
    </section>
  )
}
