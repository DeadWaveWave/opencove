import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import {
  formatAppErrorMessage,
  isAppErrorDescriptor,
  OpenCoveAppError,
} from '@shared/errors/appError'

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

  return 'Unknown error'
}

export function toAgentNodeTitle(provider: AgentProvider, model: string | null): string {
  const providerTitle = provider === 'codex' ? 'codex' : 'claude'
  return `${providerTitle} · ${model ?? 'default-model'}`
}

export function toRelativeTime(iso: string | null): string {
  if (!iso) {
    return 'just now'
  }

  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) {
    return 'just now'
  }

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (deltaSeconds < 60) {
    return 'just now'
  }

  if (deltaSeconds < 3600) {
    return `${Math.floor(deltaSeconds / 60)}m ago`
  }

  if (deltaSeconds < 86400) {
    return `${Math.floor(deltaSeconds / 3600)}h ago`
  }

  return `${Math.floor(deltaSeconds / 86400)}d ago`
}
