import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { getActiveUiLanguage, translate } from '@app/renderer/i18n'
import {
  formatAppErrorMessage,
  isAppErrorDescriptor,
  OpenCoveAppError,
} from '@shared/errors/appError'

const relativeTimeFormatterByLanguage = new Map<string, Intl.RelativeTimeFormat>()

function getRelativeTimeFormatter(language: string): Intl.RelativeTimeFormat {
  const cached = relativeTimeFormatterByLanguage.get(language)
  if (cached) {
    return cached
  }

  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  relativeTimeFormatterByLanguage.set(language, formatter)
  return formatter
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof OpenCoveAppError) {
    return formatAppErrorMessage(error)
  }

  if (isAppErrorDescriptor(error)) {
    return formatAppErrorMessage(error)
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.length > 0) {
    return error
  }

  return translate('common.unknownError')
}

export function toAgentNodeTitle(provider: AgentProvider, model: string | null): string {
  const providerTitle =
    provider === 'claude-code'
      ? 'claude'
      : provider === 'opencode'
        ? 'opencode'
        : provider === 'gemini'
          ? 'gemini'
          : 'codex'
  return `${providerTitle} · ${model ?? translate('common.defaultModel')}`
}

export function toRelativeTime(iso: string | null): string {
  const formatter = getRelativeTimeFormatter(getActiveUiLanguage())

  if (!iso) {
    return formatter.format(0, 'second')
  }

  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) {
    return formatter.format(0, 'second')
  }

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (deltaSeconds < 60) {
    return formatter.format(0, 'second')
  }

  if (deltaSeconds < 3600) {
    return formatter.format(-Math.floor(deltaSeconds / 60), 'minute')
  }

  if (deltaSeconds < 86400) {
    return formatter.format(-Math.floor(deltaSeconds / 3600), 'hour')
  }

  return formatter.format(-Math.floor(deltaSeconds / 86400), 'day')
}
