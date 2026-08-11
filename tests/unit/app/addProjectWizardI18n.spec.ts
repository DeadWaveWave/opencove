import { describe, expect, it } from 'vitest'
import { enShell } from '../../../src/app/renderer/i18n/locales/en.shell'
import { enSettingsPanelLayout } from '../../../src/app/renderer/i18n/locales/en.settingsPanel.layout'
import { zhCNShell } from '../../../src/app/renderer/i18n/locales/zh-CN.shell'
import { zhCNSettingsPanelLayout } from '../../../src/app/renderer/i18n/locales/zh-CN.settingsPanel.layout'
import {
  CANONICAL_SETTINGS_PAGE_DEFINITIONS,
  SETTINGS_PAGE_REGISTRY,
} from '../../../src/contexts/settings/presentation/renderer/settingsPanel/settingsPageRegistry'

describe('add project wizard translations', () => {
  it('points both locales at the real Worker & Connections settings destination', () => {
    expect(SETTINGS_PAGE_REGISTRY.endpoints).toMatchObject({
      canonicalPageId: 'worker',
      scrollTargetId: 'settings-section-endpoints',
    })
    expect(CANONICAL_SETTINGS_PAGE_DEFINITIONS.worker.navLabelKey).toBe(
      'settingsPanel.nav.workerConnections',
    )
    expect(enSettingsPanelLayout.nav.workerConnections).toBe('Worker & Connections')
    expect(zhCNSettingsPanelLayout.nav.workerConnections).toBe('Worker 与连接')
    expect(enShell.addProjectWizard.noRemoteWorkersHint).toContain(
      'Settings → Worker & Connections',
    )
    expect(zhCNShell.addProjectWizard.noRemoteWorkersHint).toContain('设置 → Worker 与连接')
  })

  it('gives an actionable path correction when a project name cannot be derived', () => {
    expect(enShell.addProjectWizard.nameRequired).toBe(
      'Choose a project folder instead of the filesystem root.',
    )
    expect(zhCNShell.addProjectWizard.nameRequired).toBe(
      '请选择具体的项目文件夹，不要直接使用文件系统根目录。',
    )
  })

  it.each([enShell, zhCNShell])('does not retain unused project-name or local-only keys', shell => {
    expect(shell.addProjectWizard).not.toHaveProperty('nameLabel')
    expect(shell.addProjectWizard).not.toHaveProperty('namePlaceholder')
    expect(shell.addProjectWizard).not.toHaveProperty('descriptionLocalOnly')
  })
})
