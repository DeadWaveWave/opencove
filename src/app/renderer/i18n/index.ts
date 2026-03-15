import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_UI_LANGUAGE, type UiLanguage } from '@contexts/settings/domain/agentSettings'
import { en } from './locales/en'
import { zhCN } from './locales/zh-CN'

type TranslationDictionary = typeof en

export type TranslateOptions = Record<string, string | number | boolean | null | undefined>
export type TranslateFn = (key: string, options?: TranslateOptions) => string

const TRANSLATIONS: Record<UiLanguage, TranslationDictionary> = {
  en,
  'zh-CN': zhCN,
}

let activeLanguage: UiLanguage = DEFAULT_UI_LANGUAGE
const languageListeners = new Set<(language: UiLanguage) => void>()

function resolveValue(
  dictionary: TranslationDictionary,
  key: string,
): string | TranslationDictionary | null {
  const parts = key.split('.')
  let current: unknown = dictionary

  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null
    }

    current = (current as Record<string, unknown>)[part]
  }

  return typeof current === 'string' || (current && typeof current === 'object')
    ? (current as string | TranslationDictionary)
    : null
}

function interpolate(template: string, options?: TranslateOptions): string {
  if (!options) {
    return template
  }

  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, rawKey: string) => {
    const value = options[rawKey.trim()]
    return value === null || value === undefined ? '' : String(value)
  })
}

function translateForLanguage(
  language: UiLanguage,
  key: string,
  options?: TranslateOptions,
): string {
  const count =
    typeof options?.count === 'number' && Number.isFinite(options.count) ? options.count : null
  const candidateKeys = count === null ? [key] : [`${key}_${count === 1 ? 'one' : 'other'}`, key]
  const dictionaries = [TRANSLATIONS[language], TRANSLATIONS[DEFAULT_UI_LANGUAGE]]

  for (const dictionary of dictionaries) {
    for (const candidate of candidateKeys) {
      const value = resolveValue(dictionary, candidate)
      if (typeof value === 'string') {
        return interpolate(value, options)
      }
    }
  }

  return key
}

const I18nContext = createContext<{
  language: UiLanguage
  t: TranslateFn
} | null>(null)

const fallbackTranslate: TranslateFn = (key, options) =>
  translateForLanguage(activeLanguage, key, options)

export function applyUiLanguage(language: UiLanguage): Promise<void> {
  if (activeLanguage === language) {
    return Promise.resolve()
  }

  activeLanguage = language
  languageListeners.forEach(listener => {
    listener(language)
  })
  return Promise.resolve()
}

export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [language, setLanguage] = useState<UiLanguage>(activeLanguage)

  useEffect(() => {
    const listener = (nextLanguage: UiLanguage) => {
      setLanguage(current => (current === nextLanguage ? current : nextLanguage))
    }

    languageListeners.add(listener)
    return () => {
      languageListeners.delete(listener)
    }
  }, [])

  const value = useMemo(
    () => ({
      language,
      t: (key: string, options?: TranslateOptions) => translateForLanguage(language, key, options),
    }),
    [language],
  )

  return React.createElement(I18nContext.Provider, { value }, children)
}

export function useTranslation(): { t: TranslateFn; i18n: { language: UiLanguage } } {
  const context = useContext(I18nContext)
  const language = context?.language ?? activeLanguage

  return {
    t: context?.t ?? fallbackTranslate,
    i18n: { language },
  }
}
