import React from 'react'
import type { WebsiteWindowPolicy } from '@shared/contracts/dto'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'
import type { BrowserMode } from '@shared/contracts/dto'
import { DiagnosticsSection } from './DiagnosticsSection'
import { ExperimentalSection } from './ExperimentalSection'

export function AdvancedSection({
  websiteWindowPolicy,
  browserDefaultMode,
  browserSearchEngine,
  websiteWindowPasteEnabled,
  performanceMonitorHeaderButtonEnabled,
  onChangeWebsiteWindowPolicy,
  onChangeBrowserDefaultMode,
  onChangeBrowserSearchEngine,
  onChangeWebsiteWindowPasteEnabled,
  onChangePerformanceMonitorHeaderButtonEnabled,
}: {
  websiteWindowPolicy: WebsiteWindowPolicy
  browserDefaultMode: BrowserMode
  browserSearchEngine: BrowserSearchEngineId
  websiteWindowPasteEnabled: boolean
  performanceMonitorHeaderButtonEnabled: boolean
  onChangeWebsiteWindowPolicy: (policy: WebsiteWindowPolicy) => void
  onChangeBrowserDefaultMode: (mode: BrowserMode) => void
  onChangeBrowserSearchEngine: (engine: BrowserSearchEngineId) => void
  onChangeWebsiteWindowPasteEnabled: (enabled: boolean) => void
  onChangePerformanceMonitorHeaderButtonEnabled: (enabled: boolean) => void
}): React.JSX.Element {
  return (
    <>
      <ExperimentalSection
        websiteWindowPolicy={websiteWindowPolicy}
        browserDefaultMode={browserDefaultMode}
        browserSearchEngine={browserSearchEngine}
        websiteWindowPasteEnabled={websiteWindowPasteEnabled}
        onChangeWebsiteWindowPolicy={onChangeWebsiteWindowPolicy}
        onChangeBrowserDefaultMode={onChangeBrowserDefaultMode}
        onChangeBrowserSearchEngine={onChangeBrowserSearchEngine}
        onChangeWebsiteWindowPasteEnabled={onChangeWebsiteWindowPasteEnabled}
      />
      <DiagnosticsSection
        headerButtonEnabled={performanceMonitorHeaderButtonEnabled}
        onChangeHeaderButtonEnabled={onChangePerformanceMonitorHeaderButtonEnabled}
      />
    </>
  )
}
