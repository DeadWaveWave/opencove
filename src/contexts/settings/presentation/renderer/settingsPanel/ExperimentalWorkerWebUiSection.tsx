import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { NumberInput } from '@app/renderer/components/ui/NumberInput'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import type {
  HomeWorkerConfigDto,
  HomeWorkerConfigurationSnapshotDto,
  WorkerStatusResult,
  WorkerWebAccessRuntimeStatusDto,
} from '@shared/contracts/dto'
import { isAppErrorDescriptor, OpenCoveAppError } from '@shared/errors/appError'
import { toErrorMessage } from './workerSectionUtils'
import { SettingsGroup, SettingsGroupBody, SettingsModule } from './SettingsGroup'
import {
  readWorkerConfigurationSnapshot,
  readWorkerConfigurationSnapshotFromError,
} from './workerWebUiRuntimeApi'

export function ExperimentalWorkerWebUiSection(): React.JSX.Element {
  const { t } = useTranslation()
  const [workerConfig, setWorkerConfig] = useState<HomeWorkerConfigDto | null>(null)
  const [workerWebAccess, setWorkerWebAccess] = useState<WorkerWebAccessRuntimeStatusDto | null>(
    null,
  )
  const [workerStatus, setWorkerStatus] = useState<WorkerStatusResult | null>(null)
  const [workerWebUiError, setWorkerWebUiError] = useState<string | null>(null)
  const [workerWebUiBusy, setWorkerWebUiBusy] = useState(false)
  const [webUiPortDraft, setWebUiPortDraft] = useState('')
  const [webUiPasswordDraft, setWebUiPasswordDraft] = useState('')
  const [revealWebUiPassword, setRevealWebUiPassword] = useState(false)
  const formatApplyError = useCallback(
    (error: unknown): string => {
      const code =
        error instanceof OpenCoveAppError || isAppErrorDescriptor(error) ? error.code : null
      if (
        code !== null ||
        (error instanceof Error &&
          (error.message === 'Worker is unavailable.' ||
            error.message === 'The request was invalid.'))
      ) {
        return t(
          code === 'common.invalid_input' ||
            (code === null &&
              error instanceof Error &&
              error.message === 'The request was invalid.')
            ? 'settingsPanel.experimental.workerWebUi.errors.invalidConfig'
            : 'settingsPanel.experimental.workerWebUi.errors.applyFailed',
        )
      }
      return toErrorMessage(error)
    },
    [t],
  )

  const applyConfigurationSnapshot = useCallback(
    (snapshot: HomeWorkerConfigurationSnapshotDto): void => {
      setWorkerConfig(snapshot.config)
      setWorkerWebAccess(snapshot.webAccess)
      setWebUiPortDraft(
        snapshot.config.webUi.port !== null ? String(snapshot.config.webUi.port) : '',
      )
    },
    [],
  )
  const refreshConfigurationSnapshot = useCallback(async () => {
    const snapshot = await readWorkerConfigurationSnapshot()
    applyConfigurationSnapshot(snapshot)
    return snapshot.webAccess
  }, [applyConfigurationSnapshot])
  const loadWorkerWebUiState = useCallback(async (): Promise<void> => {
    setWorkerWebUiError(null)

    try {
      const [snapshot, status] = await Promise.all([
        readWorkerConfigurationSnapshot(),
        window.opencoveApi.worker.getStatus(),
      ])

      applyConfigurationSnapshot(snapshot)
      setWorkerStatus(status)
    } catch (caughtError) {
      setWorkerWebUiError(toErrorMessage(caughtError))
    }
  }, [applyConfigurationSnapshot])

  useEffect(() => {
    void loadWorkerWebUiState()
  }, [loadWorkerWebUiState])

  const recordApplyFailure = useCallback(
    async (caughtError: unknown): Promise<void> => {
      let runtimeStatus: WorkerWebAccessRuntimeStatusDto | null = null
      const failureSnapshot = readWorkerConfigurationSnapshotFromError(caughtError)
      if (failureSnapshot) {
        applyConfigurationSnapshot(failureSnapshot)
        runtimeStatus = failureSnapshot.webAccess
      } else {
        try {
          runtimeStatus = await refreshConfigurationSnapshot()
        } catch {}
      }
      setWorkerWebUiError(
        runtimeStatus?.state === 'degraded'
          ? t('settingsPanel.experimental.workerWebUi.errors.degraded')
          : formatApplyError(caughtError),
      )
    },
    [applyConfigurationSnapshot, formatApplyError, refreshConfigurationSnapshot, t],
  )

  const workerWebUiStatusLabel = useMemo((): string => {
    if (!workerConfig || !workerStatus) {
      return t('common.loading')
    }

    if (workerConfig.mode !== 'local') {
      return t('settingsPanel.experimental.workerWebUi.status.requiresLocal')
    }

    if (!workerConfig.webUi.enabled) {
      return t('settingsPanel.experimental.workerWebUi.status.disabled')
    }
    if (workerWebAccess?.state === 'degraded') {
      return t('settingsPanel.experimental.workerWebUi.status.degraded')
    }
    return workerWebAccess?.state === 'active' && workerStatus.status === 'running'
      ? t('settingsPanel.experimental.workerWebUi.status.running')
      : t('settingsPanel.experimental.workerWebUi.status.stopped')
  }, [t, workerConfig, workerStatus, workerWebAccess])

  const canOpenWorkerWebUi = useMemo((): boolean => {
    return Boolean(
      workerConfig?.mode === 'local' &&
      workerConfig?.webUi.enabled &&
      workerStatus?.status === 'running' &&
      workerStatus.connection &&
      workerWebAccess?.state === 'active',
    )
  }, [workerConfig, workerStatus, workerWebAccess])

  const openWorkerWebUi = useCallback(async (): Promise<void> => {
    setWorkerWebUiError(null)
    setWorkerWebUiBusy(true)

    try {
      const url = await window.opencoveApi.worker.getWebUiUrl()
      if (!url) {
        setWorkerWebUiError(t('settingsPanel.experimental.workerWebUi.errors.noUrl'))
        return
      }

      window.open(url)
    } catch (caughtError) {
      setWorkerWebUiError(toErrorMessage(caughtError))
    } finally {
      setWorkerWebUiBusy(false)
    }
  }, [t])

  const canConfigureWorkerWebUiSettings = useMemo((): boolean => {
    return workerConfig?.mode === 'local'
  }, [workerConfig?.mode])

  const canConfigureWorkerWebUiSecurity = useMemo((): boolean => {
    return workerConfig?.mode === 'local' && workerConfig.webUi.enabled
  }, [workerConfig?.mode, workerConfig?.webUi.enabled])

  const toggleWorkerWebUiEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (!canConfigureWorkerWebUiSettings || !workerConfig) {
        return
      }

      setWorkerWebUiError(null)
      setWorkerWebUiBusy(true)

      try {
        setWorkerConfig(
          await window.opencoveApi.workerClient.setWebUiSettings({
            enabled,
            port: workerConfig.webUi.port,
          }),
        )
        await refreshConfigurationSnapshot()
      } catch (caughtError) {
        await recordApplyFailure(caughtError)
      } finally {
        setWorkerWebUiBusy(false)
      }
    },
    [
      canConfigureWorkerWebUiSettings,
      recordApplyFailure,
      refreshConfigurationSnapshot,
      workerConfig,
    ],
  )

  const saveWorkerWebUiPort = useCallback(async (): Promise<void> => {
    if (!canConfigureWorkerWebUiSettings || !workerConfig) {
      return
    }

    const trimmed = webUiPortDraft.trim()
    const parsed = trimmed.length === 0 ? null : Number(trimmed)
    const nextPort = parsed === 0 ? null : parsed

    if (
      nextPort !== null &&
      (!Number.isFinite(nextPort) ||
        !Number.isInteger(nextPort) ||
        nextPort <= 0 ||
        nextPort > 65_535)
    ) {
      setWorkerWebUiError(t('settingsPanel.experimental.workerWebUi.errors.invalidPort'))
      return
    }

    setWorkerWebUiError(null)
    setWorkerWebUiBusy(true)

    try {
      const nextConfig = await window.opencoveApi.workerClient.setWebUiSettings({
        enabled: workerConfig.webUi.enabled,
        port: nextPort,
      })
      setWorkerConfig(nextConfig)
      setWebUiPortDraft(nextConfig.webUi.port !== null ? String(nextConfig.webUi.port) : '')
      await refreshConfigurationSnapshot()
    } catch (caughtError) {
      await recordApplyFailure(caughtError)
    } finally {
      setWorkerWebUiBusy(false)
    }
  }, [
    canConfigureWorkerWebUiSettings,
    recordApplyFailure,
    refreshConfigurationSnapshot,
    t,
    webUiPortDraft,
    workerConfig,
  ])

  const setWorkerWebUiPassword = useCallback(async (): Promise<void> => {
    if (!canConfigureWorkerWebUiSecurity) {
      return
    }

    const normalized = webUiPasswordDraft.trim()
    if (normalized.length === 0) {
      setWorkerWebUiError(t('settingsPanel.experimental.workerWebUi.errors.passwordRequired'))
      return
    }

    setWorkerWebUiError(null)
    setWorkerWebUiBusy(true)
    try {
      const nextConfig = await window.opencoveApi.workerClient.setWebUiSecurity({
        exposeOnLan: workerConfig?.webUi.exposeOnLan ?? false,
        password: normalized,
      })
      setWorkerConfig(nextConfig)
      setWebUiPasswordDraft('')
      await refreshConfigurationSnapshot()
    } catch (caughtError) {
      await recordApplyFailure(caughtError)
    } finally {
      setWorkerWebUiBusy(false)
    }
  }, [
    canConfigureWorkerWebUiSecurity,
    recordApplyFailure,
    refreshConfigurationSnapshot,
    t,
    webUiPasswordDraft,
    workerConfig?.webUi.exposeOnLan,
  ])

  const toggleWorkerWebUiLan = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (!canConfigureWorkerWebUiSecurity) {
        return
      }

      if (enabled && !workerConfig?.webUi.passwordSet) {
        setWorkerWebUiError(t('settingsPanel.experimental.workerWebUi.errors.passwordRequired'))
        return
      }

      setWorkerWebUiError(null)
      setWorkerWebUiBusy(true)
      try {
        const nextConfig = await window.opencoveApi.workerClient.setWebUiSecurity({
          exposeOnLan: enabled,
          password: null,
        })
        setWorkerConfig(nextConfig)
        await refreshConfigurationSnapshot()
      } catch (caughtError) {
        await recordApplyFailure(caughtError)
      } finally {
        setWorkerWebUiBusy(false)
      }
    },
    [
      canConfigureWorkerWebUiSecurity,
      recordApplyFailure,
      refreshConfigurationSnapshot,
      t,
      workerConfig?.webUi.passwordSet,
    ],
  )

  return (
    <SettingsGroup
      id="settings-section-worker-web-ui"
      title={t('settingsPanel.groups.worker.webAccess')}
      description={t('settingsPanel.experimental.workerWebUi.help')}
    >
      <SettingsGroupBody>
        {workerWebUiError ? (
          <SettingRow
            label={t('common.error')}
            value={
              <span className="settings-panel__value" style={{ color: 'var(--cove-danger-text)' }}>
                {workerWebUiError}
              </span>
            }
          />
        ) : null}

        <SettingRow
          id="settings-section-worker-web-ui-service"
          label={t('settingsPanel.experimental.workerWebUi.enabledLabel')}
          description={
            <>
              {t('settingsPanel.experimental.workerWebUi.enabledHelp')}
              {!canOpenWorkerWebUi ? (
                <span
                  className="cove-setting-row__description-line"
                  data-testid="settings-experimental-worker-web-ui-status"
                >
                  {workerWebUiStatusLabel}
                </span>
              ) : null}
            </>
          }
          value={
            <>
              <IconButton
                label={t('settingsPanel.experimental.workerWebUi.refresh')}
                data-testid="settings-experimental-worker-web-ui-refresh"
                disabled={workerWebUiBusy}
                onClick={() => void loadWorkerWebUiState()}
              >
                <RefreshCw size={14} aria-hidden="true" />
              </IconButton>
              <Toggle
                data-testid="settings-experimental-worker-web-ui-enabled"
                checked={workerConfig?.webUi.enabled ?? false}
                disabled={!canConfigureWorkerWebUiSettings || workerWebUiBusy}
                label={t('settingsPanel.experimental.workerWebUi.enabledLabel')}
                onCheckedChange={checked => void toggleWorkerWebUiEnabled(checked)}
              />
            </>
          }
        />

        <SettingRow
          label={t('settingsPanel.experimental.workerWebUi.portLabel')}
          description={t('settingsPanel.experimental.workerWebUi.portHelp')}
          value={
            <>
              <NumberInput
                style={{ width: 120 }}
                min={0}
                max={65_535}
                aria-label={t('settingsPanel.experimental.workerWebUi.portLabel')}
                value={webUiPortDraft}
                disabled={!canConfigureWorkerWebUiSettings || workerWebUiBusy}
                placeholder={t('settingsPanel.experimental.workerWebUi.portPlaceholder')}
                onChange={event => setWebUiPortDraft(event.target.value)}
                data-testid="settings-experimental-worker-web-ui-port"
              />
              <Button
                variant="primary"
                disabled={!canConfigureWorkerWebUiSettings || workerWebUiBusy}
                onClick={() => void saveWorkerWebUiPort()}
                data-testid="settings-experimental-worker-web-ui-port-save"
              >
                {t('settingsPanel.experimental.workerWebUi.portSave')}
              </Button>
            </>
          }
        />

        {canOpenWorkerWebUi ? (
          <SettingRow
            label={t('settingsPanel.experimental.workerWebUi.statusLabel')}
            value={
              <>
                <span
                  className="settings-panel__value"
                  data-testid="settings-experimental-worker-web-ui-status"
                >
                  {workerWebUiStatusLabel}
                </span>
                <Button
                  variant="primary"
                  data-testid="settings-experimental-worker-web-ui-open"
                  disabled={workerWebUiBusy}
                  onClick={() => void openWorkerWebUi()}
                >
                  {t('settingsPanel.experimental.workerWebUi.open')}
                </Button>
              </>
            }
          />
        ) : null}
        <SettingsModule
          id="settings-section-worker-web-ui-security"
          title={t('settingsPanel.experimental.workerWebUi.securityTitle')}
        >
          <SettingRow
            label={t('settingsPanel.experimental.workerWebUi.lanLabel')}
            description={t('settingsPanel.experimental.workerWebUi.lanHelp')}
            control={
              <Toggle
                data-testid="settings-experimental-worker-web-ui-lan"
                checked={workerConfig?.webUi.exposeOnLan ?? false}
                disabled={!canConfigureWorkerWebUiSecurity || workerWebUiBusy}
                label={t('settingsPanel.experimental.workerWebUi.lanLabel')}
                onCheckedChange={checked => void toggleWorkerWebUiLan(checked)}
              />
            }
          />

          <SettingRow
            label={t('settingsPanel.experimental.workerWebUi.passwordLabel')}
            description={
              workerConfig?.webUi.passwordSet
                ? t('settingsPanel.experimental.workerWebUi.passwordHelpSet')
                : t('settingsPanel.experimental.workerWebUi.passwordHelpUnset')
            }
            value={
              <>
                <input
                  className="cove-field"
                  style={{ width: 240 }}
                  type={revealWebUiPassword ? 'text' : 'password'}
                  aria-label={t('settingsPanel.experimental.workerWebUi.passwordLabel')}
                  value={webUiPasswordDraft}
                  disabled={!canConfigureWorkerWebUiSecurity || workerWebUiBusy}
                  placeholder={t('settingsPanel.experimental.workerWebUi.passwordPlaceholder')}
                  onChange={event => setWebUiPasswordDraft(event.target.value)}
                  data-testid="settings-experimental-worker-web-ui-password"
                />
                <Button
                  variant="secondary"
                  disabled={!canConfigureWorkerWebUiSecurity || workerWebUiBusy}
                  onClick={() => setRevealWebUiPassword(prev => !prev)}
                  data-testid="settings-experimental-worker-web-ui-password-reveal"
                >
                  {revealWebUiPassword
                    ? t('settingsPanel.experimental.workerWebUi.passwordHide')
                    : t('settingsPanel.experimental.workerWebUi.passwordShow')}
                </Button>
                <Button
                  variant="primary"
                  disabled={!canConfigureWorkerWebUiSecurity || workerWebUiBusy}
                  onClick={() => void setWorkerWebUiPassword()}
                  data-testid="settings-experimental-worker-web-ui-password-save"
                >
                  {t('settingsPanel.experimental.workerWebUi.passwordSave')}
                </Button>
              </>
            }
          />
        </SettingsModule>
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
