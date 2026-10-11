import { useEffect, useRef, useState, type JSX } from 'react'
import { PluginCandidateList, type PluginCandidateInfo } from './PluginCandidateList'
import { Download, History } from 'lucide-react'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import { changeInstalledPlugin } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { pluginErrorMessage } from '@contexts/plugins/presentation/renderer/pluginErrorMessage'

interface SourceInfo {
  distribution: { repository: string; ref: string } | null
  candidates?: PluginCandidateInfo[]
  sourceDirectory?: string
  dirty: boolean
  history: Array<{ revision: string; version: string }>
}
interface UpdateInfo {
  updateAvailable: boolean
  currentCommit: string
  availableCommit: string
}
interface UpdateResult {
  status: 'updated' | 'conflict' | 'failed'
  error?: string
  candidateDirectory?: string
}

export function PluginSourceControls({ plugin }: { plugin: PluginManifest }): JSX.Element | null {
  const { t } = useTranslation()
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [revision, setRevision] = useState('')
  const [updateRef, setUpdateRef] = useState('')
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const request = ++generation.current
    setSource(null)
    setUpdate(null)
    setRevision('')
    setBusy(false)
    busyRef.current = false
    setError(null)
    setMessage(null)
    void window.opencoveApi.controlSurface
      .invoke<SourceInfo>({ kind: 'query', id: 'plugin.source', payload: { pluginId: plugin.id } })
      .then(value => {
        if (generation.current === request) {
          setSource(value)
          setUpdateRef(value.distribution?.ref ?? '')
        }
      })
      .catch((cause: unknown) => {
        if (generation.current === request) {
          setSource(null)
          setError(pluginErrorMessage(cause))
        }
      })
    return () => {
      generation.current += 1
    }
  }, [plugin.id, plugin.revision, plugin.runtimeGeneration])
  async function run(
    action: 'check' | 'update' | 'rollback' | 'apply',
    candidateId?: string,
  ): Promise<void> {
    if (busyRef.current) {
      return
    }
    const request = generation.current
    busyRef.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (action === 'check') {
        const result = await window.opencoveApi.controlSurface.invoke<UpdateInfo>({
          kind: 'command',
          id: 'plugin.git.check',
          payload: {
            pluginId: plugin.id,
            ...(updateRef.trim() && updateRef.trim() !== source?.distribution?.ref
              ? { ref: updateRef.trim() }
              : {}),
          },
        })
        if (request === generation.current) {
          const updateAvailable =
            result.updateAvailable ||
            Boolean(updateRef.trim() && updateRef.trim() !== source?.distribution?.ref)
          setUpdate({ ...result, updateAvailable })
          setMessage(t(`settingsPanel.plugins.source.${updateAvailable ? 'available' : 'current'}`))
        }
      } else if (action === 'update' || action === 'apply') {
        const result = await changeInstalledPlugin<UpdateResult>(
          action === 'apply' ? 'plugin.git.apply' : 'plugin.git.update',
          action === 'apply'
            ? { candidateId }
            : {
                pluginId: plugin.id,
                ...(updateRef.trim() && updateRef.trim() !== source?.distribution?.ref
                  ? { ref: updateRef.trim() }
                  : {}),
              },
        )
        const fresh = await window.opencoveApi.controlSurface.invoke<SourceInfo>({
          kind: 'query',
          id: 'plugin.source',
          payload: { pluginId: plugin.id },
        })
        if (request === generation.current) {
          setSource(fresh)
        }
        if (result.status !== 'updated') {
          throw new Error(
            [result.error, result.candidateDirectory].filter(Boolean).join('\n') ||
              t('settingsPanel.plugins.source.failed'),
          )
        }
      } else {
        await changeInstalledPlugin('plugin.rollback', { pluginId: plugin.id, revision })
      }
    } catch (cause) {
      if (request === generation.current) {
        setError(pluginErrorMessage(cause))
      }
    } finally {
      if (request === generation.current) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }
  if (!source) {
    return error ? (
      <p className="cove-window__error" role="alert">
        {error}
      </p>
    ) : null
  }
  if (!source.distribution && (source.history?.length ?? 0) < 1 && !source.candidates?.length) {
    return null
  }
  const previous = source.history?.filter(item => item.revision !== plugin.revision) ?? []
  return (
    <div className="settings-plugin-source" data-testid="settings-plugin-source-controls">
      {source.distribution ? (
        <>
          <div className="settings-plugin-source__identity">
            <span>{t('settingsPanel.plugins.source.repository')}</span>
            <span>{source.distribution.repository}</span>
          </div>
          <label className="settings-plugin-source__ref">
            {t('settingsPanel.plugins.source.updateRef')}
            <input
              className="cove-field"
              value={updateRef}
              disabled={busy}
              onChange={event => {
                setUpdateRef(event.target.value)
                setUpdate(null)
                setMessage(null)
              }}
              data-testid="settings-plugin-update-ref"
            />
          </label>
          {source.dirty ? <p>{t('settingsPanel.plugins.source.dirty')}</p> : null}
          <div className="settings-plugin-runtime__actions">
            <button
              type="button"
              className="cove-window__action cove-window__action--secondary"
              disabled={busy}
              onClick={() => void run('check')}
              data-testid="settings-plugin-check-update"
            >
              <Download size={14} aria-hidden="true" />
              {t('settingsPanel.plugins.source.check')}
            </button>
            {update?.updateAvailable ? (
              <button
                type="button"
                className="cove-window__action cove-window__action--secondary"
                disabled={busy}
                onClick={() => void run('update')}
                data-testid="settings-plugin-apply-update"
              >
                {t('settingsPanel.plugins.source.update')}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      <PluginCandidateList
        candidates={source.candidates ?? []}
        busy={busy}
        onApply={id => void run('apply', id)}
      />
      {previous.length ? (
        <details className="settings-plugin-source__history">
          <summary>
            <History size={13} aria-hidden="true" />
            {t('settingsPanel.plugins.source.history')}
          </summary>
          <p>{t('settingsPanel.plugins.source.rollbackHelp')}</p>
          <div className="settings-plugin-source__version">
            <span>{t('settingsPanel.plugins.source.revision')}</span>
            <CoveSelect
              testId="settings-plugin-rollback-version"
              value={revision}
              disabled={busy}
              ariaLabel={t('settingsPanel.plugins.source.revision')}
              options={[
                { value: '', label: t('settingsPanel.plugins.source.choose') },
                ...previous.map(item => ({
                  value: item.revision,
                  label: `${item.version} · ${item.revision.slice(0, 12)}`,
                })),
              ]}
              onChange={setRevision}
            />
          </div>
          <button
            type="button"
            className="cove-window__action cove-window__action--secondary"
            disabled={busy || !revision}
            onClick={() => void run('rollback')}
          >
            {t('settingsPanel.plugins.source.rollback')}
          </button>
        </details>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p className="cove-window__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
