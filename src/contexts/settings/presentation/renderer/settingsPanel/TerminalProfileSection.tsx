import React from 'react'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { useTranslation } from '@app/renderer/i18n'
import { getStandardWindowSizeBucketLabel } from '@app/renderer/i18n/labels'
import {
  STANDARD_WINDOW_SIZE_BUCKETS,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import type { TerminalProfile } from '@shared/contracts/dto'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export function TerminalProfileSection({
  standardWindowSizeBucket,
  defaultTerminalProfileId,
  terminalProfiles,
  detectedDefaultTerminalProfileId,
  onChangeStandardWindowSizeBucket,
  onChangeDefaultTerminalProfileId,
}: {
  standardWindowSizeBucket: StandardWindowSizeBucket
  defaultTerminalProfileId: string | null
  terminalProfiles: TerminalProfile[]
  detectedDefaultTerminalProfileId: string | null
  onChangeStandardWindowSizeBucket: (bucket: StandardWindowSizeBucket) => void
  onChangeDefaultTerminalProfileId: (profileId: string | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const selectedProfileId = terminalProfiles.some(
    profile => profile.id === defaultTerminalProfileId,
  )
    ? defaultTerminalProfileId
    : null
  const defaultProfileLabel =
    terminalProfiles.find(profile => profile.id === detectedDefaultTerminalProfileId)?.label ??
    t('settingsPanel.terminal.profileAuto')

  return (
    <SettingsGroup
      id="settings-section-terminal-profile"
      title={t('settingsPanel.groups.canvasWindows.windowTerminal')}
    >
      <SettingsGroupBody>
        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.canvas.standardWindowSizeLabel')}</strong>
            <span>{t('settingsPanel.canvas.standardWindowSizeHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <CoveSelect
              id="settings-standard-window-size"
              testId="settings-standard-window-size"
              ariaLabel={t('settingsPanel.canvas.standardWindowSizeLabel')}
              value={standardWindowSizeBucket}
              options={STANDARD_WINDOW_SIZE_BUCKETS.map(bucket => ({
                value: bucket,
                label: getStandardWindowSizeBucketLabel(t, bucket),
              }))}
              onChange={nextValue =>
                onChangeStandardWindowSizeBucket(nextValue as StandardWindowSizeBucket)
              }
            />
          </div>
        </div>

        {terminalProfiles.length > 0 ? (
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.terminal.profileLabel')}</strong>
              <span>
                {t('settingsPanel.terminal.profileHelp', {
                  defaultProfile: defaultProfileLabel,
                })}
              </span>
            </div>
            <div className="settings-panel__control">
              <CoveSelect
                id="settings-terminal-profile"
                testId="settings-terminal-profile"
                ariaLabel={t('settingsPanel.terminal.profileLabel')}
                value={selectedProfileId ?? ''}
                options={[
                  {
                    value: '',
                    label: t('settingsPanel.terminal.profileAutoWithDefault', {
                      defaultProfile: defaultProfileLabel,
                    }),
                  },
                  ...terminalProfiles.map(profile => ({
                    value: profile.id,
                    label: profile.label,
                  })),
                ]}
                onChange={nextValue =>
                  onChangeDefaultTerminalProfileId(nextValue.trim().length > 0 ? nextValue : null)
                }
              />
            </div>
          </div>
        ) : null}
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
