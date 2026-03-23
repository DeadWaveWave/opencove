import { useEffect } from 'react'
import type { UiLanguage } from '@contexts/settings/domain/agentSettings'
import { applyUiLanguage } from '@app/renderer/i18n'

export function useApplyUiLanguage(language: UiLanguage): void {
  useEffect(() => {
    document.documentElement.lang = language
    void applyUiLanguage(language)
  }, [language])
}
