import { useEffect, useState, type JSX } from 'react'
import { ArrowLeft, ExternalLink, GitBranch, Puzzle } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginRepositoryDetails } from '@contexts/plugins/domain/pluginRepositoryTypes'
import { PluginReadme } from '@contexts/plugins/presentation/renderer/PluginReadme'
import { pluginErrorMessage } from '@contexts/plugins/presentation/renderer/pluginErrorMessage'

export function repositoryMarkdownUrl(
  details: PluginRepositoryDetails,
  href: string,
  kind: string,
): string {
  if (href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return href
  }
  if (href.startsWith('//') || href.includes('\\')) {
    return ''
  }
  const path = details.readmePath?.split('/').slice(0, -1).join('/') ?? ''
  const base =
    kind === 'src'
      ? `https://raw.githubusercontent.com/${details.name}/${details.commit}/`
      : `${details.repository}/blob/${details.commit}/`
  const resolved = new URL(href, `${base}${path ? `${path}/` : ''}`).href
  return resolved.startsWith(base) ? resolved : ''
}

export function PluginRepositoryDetail({
  repository,
  onBack,
  onChoose,
}: {
  repository: string
  onBack: () => void
  onChoose: (details: PluginRepositoryDetails) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [details, setDetails] = useState<PluginRepositoryDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setDetails(null)
    setError(null)
    void window.opencoveApi.controlSurface
      .invoke<PluginRepositoryDetails>({
        kind: 'query',
        id: 'plugin.repository.details',
        payload: { repository },
      })
      .then(value => {
        if (alive) {
          setDetails(value)
        }
      })
      .catch(cause => {
        if (alive) {
          setError(pluginErrorMessage(cause))
        }
      })
    return () => {
      alive = false
    }
  }, [repository, attempt])
  return (
    <section className="settings-plugin-repository" data-testid="settings-plugin-repository-detail">
      <button
        type="button"
        className="cove-window__action cove-window__action--ghost"
        onClick={onBack}
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {t('settingsPanel.plugins.repository.back')}
      </button>
      {error ? (
        <div role="alert">
          <p className="cove-window__error">{error}</p>
          <button
            type="button"
            className="cove-window__action cove-window__action--secondary"
            onClick={() => setAttempt(value => value + 1)}
          >
            {t('settingsPanel.plugins.runtime.retry')}
          </button>
        </div>
      ) : null}
      {!details && !error ? (
        <p role="status">{t('settingsPanel.plugins.repository.loading')}</p>
      ) : null}
      {details ? (
        <>
          <header className="settings-plugin-repository__heading">
            <Puzzle size={28} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <h4>{details.manifest?.displayName ?? details.name}</h4>
              <p>{details.description}</p>
            </div>
          </header>
          <div className="settings-plugin-repository__metadata">
            <a href={details.repository} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} aria-hidden="true" />
              {details.name}
            </a>
            <span>
              <GitBranch size={13} aria-hidden="true" />
              {details.ref} · {details.commit.slice(0, 10)}
            </span>
            {details.manifest ? <span>{details.manifest.version}</span> : null}
          </div>
          {details.manifest ? (
            <dl className="settings-plugin-repository__requirements">
              <div>
                <dt>{t('settingsPanel.plugins.repository.hostVersion')}</dt>
                <dd>
                  {details.manifest.engines?.opencove ??
                    t('settingsPanel.plugins.repository.notDeclared')}
                </dd>
              </div>
              <div>
                <dt>{t('settingsPanel.plugins.repository.platforms')}</dt>
                <dd>
                  {details.manifest.platforms?.join(', ') ??
                    t('settingsPanel.plugins.repository.allPlatforms')}
                </dd>
              </div>
            </dl>
          ) : null}
          {details.manifestError ? <p role="status">{details.manifestError}</p> : null}
          <p>{t('settingsPanel.plugins.repository.readOnly')}</p>
          <button
            type="button"
            className="cove-window__action cove-window__action--secondary"
            onClick={() => onChoose(details)}
            data-testid="settings-plugin-repository-choose"
          >
            {t('settingsPanel.plugins.repository.choose')}
          </button>
          <div className="settings-plugin-repository__readme">
            {details.readme ? (
              <PluginReadme
                markdown={details.readme}
                resolveUrl={(url, kind) => repositoryMarkdownUrl(details, url, kind)}
              />
            ) : (
              <p>{t('settingsPanel.plugins.repository.noReadme')}</p>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
