import React, { useEffect, useState } from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { useTranslation } from '@app/renderer/i18n'
import type { CliPathStatusResult, HomeWorkerMode, WorkerStatusResult } from '@shared/contracts/dto'
import { SettingsGroup, SettingsGroupBody, SettingsModule } from './SettingsGroup'
import { formatToken, toBaseUrl } from './workerSectionUtils'
import { toErrorMessage } from '@app/renderer/shell/utils/format'

export function WorkerSection(): React.JSX.Element {
  const { t } = useTranslation()
  const [savedMode, setSavedMode] = useState<HomeWorkerMode | null>(null)
  const [localStatus, setLocalStatus] = useState<WorkerStatusResult | null>(null)
  const [cliStatus, setCliStatus] = useState<CliPathStatusResult | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealLocalToken, setRevealLocalToken] = useState(false)
  const localConnection = localStatus?.connection ?? null

  const load = async (): Promise<void> => {
    const [config, status, cli] = await Promise.all([
      window.opencoveApi.workerClient.getConfig(),
      window.opencoveApi.worker.getStatus(),
      window.opencoveApi.cli.getStatus(),
    ])

    setSavedMode(config.mode)
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
    <SettingsGroup id="settings-section-worker" title={t('settingsPanel.groups.worker.runtime')}>
      <SettingsGroupBody id="settings-section-worker-home">
        {error ? (
          <SettingRow
            label={t('common.error')}
            value={
              <span className="settings-panel__value" style={{ color: 'var(--cove-danger-text)' }}>
                {error}
              </span>
            }
          />
        ) : null}

        <SettingsModule
          id="settings-section-worker-cli"
          title={t('settingsPanel.worker.cli.title')}
          description={t('settingsPanel.worker.cli.help')}
        >
          <SettingRow
            label={t('settingsPanel.worker.cli.statusLabel')}
            value={
              <span className="settings-panel__value" data-testid="settings-worker-cli-status">
                {cliStatus?.installed
                  ? cliStatus.healthy
                    ? t('settingsPanel.worker.cli.status.installed', {
                        path: cliStatus.path ?? '—',
                      })
                    : t('settingsPanel.worker.cli.status.needsRepair', {
                        path: cliStatus.path ?? '—',
                      })
                  : t('settingsPanel.worker.cli.status.notInstalled')}
              </span>
            }
          />

          <SettingRow
            label={t('settingsPanel.worker.cli.actionsLabel')}
            value={
              <>
                <Button
                  variant="secondary"
                  data-testid="settings-worker-cli-install"
                  disabled={isBusy}
                  onClick={() => void installCli()}
                >
                  {t('settingsPanel.worker.cli.install')}
                </Button>
                <Button
                  variant="secondary"
                  data-testid="settings-worker-cli-uninstall"
                  disabled={isBusy || !cliStatus?.installed}
                  onClick={() => void uninstallCli()}
                >
                  {t('settingsPanel.worker.cli.uninstall')}
                </Button>
              </>
            }
          />
        </SettingsModule>

        <SettingsModule
          id="settings-section-worker-local"
          title={t('settingsPanel.worker.local.title')}
          actions={
            <div className="settings-panel__control settings-panel__control--actions">
              <Button
                variant="secondary"
                data-testid="settings-worker-local-start"
                disabled={isBusy || savedMode === null || localStatus?.status === 'running'}
                onClick={startLocalWorker}
              >
                {t('settingsPanel.worker.local.start')}
              </Button>
              <Button
                variant="secondary"
                data-testid="settings-worker-local-stop"
                disabled={isBusy || localStatus?.status !== 'running'}
                onClick={stopLocalWorker}
              >
                {t('settingsPanel.worker.local.stop')}
              </Button>
            </div>
          }
        >
          {localConnection ? (
            <>
              <SettingRow
                label={t('settingsPanel.worker.local.baseUrlLabel')}
                value={
                  <>
                    <span
                      className="settings-panel__value"
                      style={{ fontFamily: 'var(--cove-font-mono)' }}
                    >
                      {toBaseUrl(localConnection)}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => void copyLocalBaseUrl()}
                      data-testid="settings-worker-local-copy-base-url"
                    >
                      {t('settingsPanel.worker.local.copyBaseUrl')}
                    </Button>
                  </>
                }
              />

              <SettingRow
                label={t('settingsPanel.worker.local.tokenLabel')}
                value={
                  <>
                    <span
                      className="settings-panel__value"
                      style={{ fontFamily: 'var(--cove-font-mono)' }}
                      data-testid="settings-worker-local-token"
                    >
                      {formatToken(localConnection.token, revealLocalToken)}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => setRevealLocalToken(value => !value)}
                      data-testid="settings-worker-local-token-toggle"
                    >
                      {revealLocalToken
                        ? t('settingsPanel.worker.local.hideToken')
                        : t('settingsPanel.worker.local.revealToken')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void copyLocalToken()}
                      data-testid="settings-worker-local-copy-token"
                    >
                      {t('settingsPanel.worker.local.copyToken')}
                    </Button>
                  </>
                }
              />
            </>
          ) : null}
        </SettingsModule>
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
