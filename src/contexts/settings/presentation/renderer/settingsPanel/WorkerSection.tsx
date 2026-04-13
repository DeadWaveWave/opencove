import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { CliPathStatusResult, HomeWorkerMode, WorkerStatusResult } from '@shared/contracts/dto'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { formatToken, toBaseUrl, toErrorMessage } from './workerSectionUtils'

export function WorkerSection(): React.JSX.Element {
  const { t } = useTranslation()
  const supportsHomeWorkerModeSelection = !window.opencoveApi.meta.isPackaged
  const defaultMode: HomeWorkerMode = supportsHomeWorkerModeSelection ? 'standalone' : 'local'
  const [savedMode, setSavedMode] = useState<HomeWorkerMode>(defaultMode)
  const [draftMode, setDraftMode] = useState<HomeWorkerMode>(defaultMode)
  const [remoteHostname, setRemoteHostname] = useState('')
  const [remotePort, setRemotePort] = useState('')
  const [remoteToken, setRemoteToken] = useState('')
  const [localStatus, setLocalStatus] = useState<WorkerStatusResult | null>(null)
  const [cliStatus, setCliStatus] = useState<CliPathStatusResult | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealLocalToken, setRevealLocalToken] = useState(false)
  const [revealRemoteToken, setRevealRemoteToken] = useState(false)
  const localConnection = localStatus?.connection ?? null
  const modeOptions = useMemo(
    () => [
      { value: 'standalone', label: t('settingsPanel.worker.home.mode.standalone') },
      { value: 'local', label: t('settingsPanel.worker.home.mode.local') },
      { value: 'remote', label: t('settingsPanel.worker.home.mode.remote') },
    ],
    [t],
  )

  const canApplyRemote = useMemo(() => {
    if (draftMode !== 'remote') {
      return true
    }

    const hostname = remoteHostname.trim()
    const token = remoteToken.trim()
    const port = Number(remotePort)

    return (
      hostname.length > 0 && token.length > 0 && Number.isFinite(port) && port > 0 && port <= 65_535
    )
  }, [draftMode, remoteHostname, remotePort, remoteToken])

  const load = async (): Promise<void> => {
    const [config, status, cli] = await Promise.all([
      window.opencoveApi.workerClient.getConfig(),
      window.opencoveApi.worker.getStatus(),
      window.opencoveApi.cli.getStatus(),
    ])

    setSavedMode(config.mode)
    setDraftMode(config.mode)
    setRemoteHostname(config.remote?.hostname ?? '')
    setRemotePort(config.remote ? String(config.remote.port) : '')
    setRemoteToken(config.remote?.token ?? '')
    setLocalStatus(status)
    setCliStatus(cli)
  }

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      }
    })()
  }, [])

  const applyAndRestart = async (): Promise<void> => {
    if (!canApplyRemote) {
      setError(t('settingsPanel.worker.errors.remoteRequired'))
      return
    }

    if (draftMode === 'standalone' && localStatus?.status === 'running') {
      setError(t('settingsPanel.worker.errors.stopLocalWorkerFirst'))
      return
    }

    setError(null)
    setIsBusy(true)

    try {
      const remote =
        draftMode === 'remote'
          ? {
              hostname: remoteHostname.trim(),
              port: Number(remotePort),
              token: remoteToken.trim(),
            }
          : null

      const nextConfig = await window.opencoveApi.workerClient.setConfig({
        mode: draftMode,
        remote,
      })
      setSavedMode(nextConfig.mode)
      await window.opencoveApi.workerClient.relaunch()
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const startLocalWorker = async (): Promise<void> => {
    if (savedMode !== 'local') {
      setError(t('settingsPanel.worker.errors.enableLocalRequiresRestart'))
      return
    }

    setError(null)
    setIsBusy(true)
    try {
      const status = await window.opencoveApi.worker.start()
      setLocalStatus(status)
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const stopLocalWorker = async (): Promise<void> => {
    setError(null)
    setIsBusy(true)
    try {
      const status = await window.opencoveApi.worker.stop()
      setLocalStatus(status)
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const copyLocalBaseUrl = async (): Promise<void> => {
    if (!localConnection) {
      return
    }

    await window.opencoveApi.clipboard.writeText(toBaseUrl(localConnection))
  }

  const copyLocalToken = async (): Promise<void> => {
    if (!localConnection) {
      return
    }

    await window.opencoveApi.clipboard.writeText(localConnection.token)
  }

  const installCli = async (): Promise<void> => {
    setError(null)
    setIsBusy(true)
    try {
      const next = await window.opencoveApi.cli.install()
      setCliStatus(next)
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const uninstallCli = async (): Promise<void> => {
    setError(null)
    setIsBusy(true)
    try {
      const next = await window.opencoveApi.cli.uninstall()
      setCliStatus(next)
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="settings-panel__section">
      <div className="settings-panel__section-header">
        <h3 className="settings-panel__section-title">{t('settingsPanel.worker.title')}</h3>
      </div>

      {error ? (
        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('common.error')}</strong>
          </div>
          <div className="settings-panel__control">
            <span className="settings-panel__value" style={{ color: 'var(--cove-danger-text)' }}>
              {error}
            </span>
          </div>
        </div>
      ) : null}

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">{t('settingsPanel.worker.home.title')}</h4>
          <span>
            {supportsHomeWorkerModeSelection
              ? t('settingsPanel.worker.home.help')
              : t('settingsPanel.worker.home.packagedHelp')}
          </span>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>
              {supportsHomeWorkerModeSelection
                ? t('settingsPanel.worker.home.modeLabel')
                : t('settingsPanel.worker.home.packagedModeLabel')}
            </strong>
          </div>
          <div className="settings-panel__control">
            {supportsHomeWorkerModeSelection ? (
              <CoveSelect
                id="settings-worker-home-mode"
                testId="settings-worker-home-mode"
                value={draftMode}
                options={modeOptions}
                onChange={nextValue => setDraftMode(nextValue as HomeWorkerMode)}
              />
            ) : (
              <span className="settings-panel__value" data-testid="settings-worker-home-mode-value">
                {t('settingsPanel.worker.home.packagedModeValue')}
              </span>
            )}
          </div>
        </div>

        {supportsHomeWorkerModeSelection && draftMode === 'remote' ? (
          <>
            <div className="settings-panel__row">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.worker.remote.hostnameLabel')}</strong>
              </div>
              <div className="settings-panel__control">
                <input
                  className="cove-field"
                  style={{ width: '100%' }}
                  type="text"
                  value={remoteHostname}
                  onChange={e => setRemoteHostname(e.target.value)}
                  data-testid="settings-worker-remote-hostname"
                />
              </div>
            </div>

            <div className="settings-panel__row">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.worker.remote.portLabel')}</strong>
              </div>
              <div className="settings-panel__control">
                <input
                  className="cove-field"
                  style={{ width: '120px' }}
                  type="number"
                  min={1}
                  max={65_535}
                  value={remotePort}
                  onChange={e => setRemotePort(e.target.value)}
                  data-testid="settings-worker-remote-port"
                />
              </div>
            </div>

            <div className="settings-panel__row">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.worker.remote.tokenLabel')}</strong>
              </div>
              <div className="settings-panel__control" style={{ gap: 8 }}>
                <input
                  className="cove-field"
                  style={{ width: '100%', fontFamily: 'var(--cove-font-mono)' }}
                  type={revealRemoteToken ? 'text' : 'password'}
                  value={remoteToken}
                  onChange={e => setRemoteToken(e.target.value)}
                  data-testid="settings-worker-remote-token"
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRevealRemoteToken(value => !value)}
                  data-testid="settings-worker-remote-token-toggle"
                >
                  {revealRemoteToken
                    ? t('settingsPanel.worker.remote.hideToken')
                    : t('settingsPanel.worker.remote.revealToken')}
                </button>
              </div>
            </div>
          </>
        ) : null}

        {supportsHomeWorkerModeSelection ? (
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.worker.home.applyLabel')}</strong>
              <span>{t('settingsPanel.worker.home.applyHelp')}</span>
            </div>
            <div className="settings-panel__control" style={{ alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="primary"
                data-testid="settings-worker-apply-restart"
                disabled={isBusy || (draftMode === 'remote' && !canApplyRemote)}
                onClick={applyAndRestart}
              >
                {t('settingsPanel.worker.home.applyRestart')}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">{t('settingsPanel.worker.cli.title')}</h4>
          <span>{t('settingsPanel.worker.cli.help')}</span>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.worker.cli.statusLabel')}</strong>
          </div>
          <div className="settings-panel__control">
            <span className="settings-panel__value" data-testid="settings-worker-cli-status">
              {cliStatus?.installed
                ? t('settingsPanel.worker.cli.status.installed', {
                    path: cliStatus.path ?? '—',
                  })
                : t('settingsPanel.worker.cli.status.notInstalled')}
            </span>
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.worker.cli.actionsLabel')}</strong>
          </div>
          <div className="settings-panel__control" style={{ alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="secondary"
              data-testid="settings-worker-cli-install"
              disabled={isBusy}
              onClick={() => void installCli()}
            >
              {t('settingsPanel.worker.cli.install')}
            </button>
            <button
              type="button"
              className="secondary"
              data-testid="settings-worker-cli-uninstall"
              disabled={isBusy || !cliStatus?.installed}
              onClick={() => void uninstallCli()}
            >
              {t('settingsPanel.worker.cli.uninstall')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">{t('settingsPanel.worker.local.title')}</h4>
          <span>{t('settingsPanel.worker.local.help')}</span>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.worker.local.statusLabel')}</strong>
          </div>
          <div className="settings-panel__control">
            <span className="settings-panel__value" data-testid="settings-worker-local-status">
              {localStatus?.status === 'running'
                ? t('settingsPanel.worker.local.status.running')
                : t('settingsPanel.worker.local.status.stopped')}
            </span>
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.worker.local.actionsLabel')}</strong>
          </div>
          <div className="settings-panel__control" style={{ alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="secondary"
              data-testid="settings-worker-local-start"
              disabled={isBusy || localStatus?.status === 'running'}
              onClick={startLocalWorker}
            >
              {t('settingsPanel.worker.local.start')}
            </button>
            <button
              type="button"
              className="secondary"
              data-testid="settings-worker-local-stop"
              disabled={isBusy || localStatus?.status !== 'running'}
              onClick={stopLocalWorker}
            >
              {t('settingsPanel.worker.local.stop')}
            </button>
          </div>
        </div>

        {localConnection ? (
          <>
            <div className="settings-panel__row">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.worker.local.baseUrlLabel')}</strong>
              </div>
              <div className="settings-panel__control" style={{ gap: 8 }}>
                <span
                  className="settings-panel__value"
                  style={{ fontFamily: 'var(--cove-font-mono)' }}
                >
                  {toBaseUrl(localConnection)}
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void copyLocalBaseUrl()}
                  data-testid="settings-worker-local-copy-base-url"
                >
                  {t('settingsPanel.worker.local.copyBaseUrl')}
                </button>
              </div>
            </div>

            <div className="settings-panel__row">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.worker.local.tokenLabel')}</strong>
              </div>
              <div className="settings-panel__control" style={{ gap: 8 }}>
                <span
                  className="settings-panel__value"
                  style={{ fontFamily: 'var(--cove-font-mono)' }}
                  data-testid="settings-worker-local-token"
                >
                  {formatToken(localConnection.token, revealLocalToken)}
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRevealLocalToken(value => !value)}
                  data-testid="settings-worker-local-token-toggle"
                >
                  {revealLocalToken
                    ? t('settingsPanel.worker.local.hideToken')
                    : t('settingsPanel.worker.local.revealToken')}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void copyLocalToken()}
                  data-testid="settings-worker-local-copy-token"
                >
                  {t('settingsPanel.worker.local.copyToken')}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
