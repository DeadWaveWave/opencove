import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ExternalLink, FolderOpen, LoaderCircle } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { IssueReportKind, PrepareIssueReportResult } from '@shared/contracts/dto'

type IssueReportStatus = 'idle' | 'generating' | 'ready' | 'copied' | 'error'

function reportFileName(reportPath: string): string {
  return reportPath.split(/[\\/]/).pop() ?? reportPath
}

function toErrorText(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : ''
}

function defaultSummaryKey(kind: IssueReportKind): string {
  if (kind === 'run_agent_failed') {
    return 'runAgentFailed'
  }

  if (kind === 'app_error') {
    return 'appError'
  }

  return 'other'
}

export function IssueReportDialog({
  isOpen,
  activeWorkspaceName,
  activeWorkspacePath,
  onClose,
}: {
  isOpen: boolean
  activeWorkspaceName: string | null
  activeWorkspacePath: string | null
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [kind, setKind] = useState<IssueReportKind>('run_agent_failed')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [includeLocalPaths, setIncludeLocalPaths] = useState(false)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [status, setStatus] = useState<IssueReportStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<PrepareIssueReportResult | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setKind('run_agent_failed')
    setSummary(t('issueReport.defaultSummary.runAgentFailed'))
    setDescription('')
    setIncludeLocalPaths(false)
    setIsDetailsOpen(false)
    setStatus('idle')
    setError(null)
    setReport(null)
  }, [isOpen, t])

  const typeOptions = useMemo<Array<{ kind: IssueReportKind; label: string }>>(
    () => [
      { kind: 'run_agent_failed', label: t('issueReport.types.runAgentFailed') },
      { kind: 'app_error', label: t('issueReport.types.appError') },
      { kind: 'other', label: t('issueReport.types.other') },
    ],
    [t],
  )

  if (!isOpen || typeof document === 'undefined' || !document.body) {
    return null
  }

  const clearPreparedReport = (): void => {
    if (report) {
      setReport(null)
    }
    if (status === 'ready' || status === 'copied') {
      setStatus('idle')
    }
    setError(null)
  }

  const prepareReport = async (): Promise<void> => {
    setStatus('generating')
    setError(null)

    try {
      const nextReport = await window.opencoveApi.issueReport.prepare({
        kind,
        title: summary,
        description,
        includeLocalPaths,
        context: {
          activeWorkspaceName,
          activeWorkspacePath,
        },
      })
      setReport(nextReport)
      setStatus('ready')
    } catch (prepareError) {
      setReport(null)
      setError(toErrorText(prepareError) || t('issueReport.generateFailed'))
      setStatus('error')
    }
  }

  const copyReport = async (): Promise<void> => {
    if (!report) {
      return
    }

    try {
      await window.opencoveApi.clipboard.writeText(report.markdown)
      setStatus('copied')
    } catch (copyError) {
      setError(toErrorText(copyError) || t('issueReport.copyFailed'))
      setStatus('error')
    }
  }

  const openGitHubIssue = async (): Promise<void> => {
    if (!report) {
      return
    }

    try {
      await window.opencoveApi.issueReport.openGitHubIssue({
        githubIssueUrl: report.githubIssueUrl,
      })
    } catch (openError) {
      setError(toErrorText(openError) || t('issueReport.openFailed'))
      setStatus('error')
    }
  }

  const showReportFile = async (): Promise<void> => {
    if (!report) {
      return
    }

    try {
      await window.opencoveApi.issueReport.showReportFile({ reportPath: report.reportPath })
    } catch (showError) {
      setError(toErrorText(showError) || t('issueReport.showFileFailed'))
      setStatus('error')
    }
  }

  return createPortal(
    <div
      className="cove-window-backdrop issue-report-backdrop"
      data-testid="issue-report-dialog"
      onClick={onClose}
    >
      <section
        className="cove-window issue-report-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-report-title"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <div className="issue-report-window__header">
          <div>
            <h3 id="issue-report-title">{t('issueReport.title')}</h3>
          </div>
        </div>

        <div className="cove-window__fields issue-report-window__fields">
          <div className="cove-window__field-row">
            <label>{t('issueReport.typeLabel')}</label>
            <div className="issue-report-window__segments">
              {typeOptions.map(option => (
                <button
                  key={option.kind}
                  type="button"
                  className={`issue-report-window__segment${
                    kind === option.kind ? ' issue-report-window__segment--selected' : ''
                  }`}
                  aria-pressed={kind === option.kind}
                  onClick={() => {
                    const currentDefaultSummaries = [
                      t('issueReport.defaultSummary.runAgentFailed'),
                      t('issueReport.defaultSummary.appError'),
                      t('issueReport.defaultSummary.other'),
                    ]
                    setKind(option.kind)
                    if (summary.trim().length === 0 || currentDefaultSummaries.includes(summary)) {
                      setSummary(t(`issueReport.defaultSummary.${defaultSummaryKey(option.kind)}`))
                    }
                    clearPreparedReport()
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="cove-window__field-row">
            <label htmlFor="issue-report-summary">{t('issueReport.summaryLabel')}</label>
            <input
              id="issue-report-summary"
              data-testid="issue-report-summary"
              value={summary}
              placeholder={t('issueReport.summaryPlaceholder')}
              onChange={event => {
                setSummary(event.target.value)
                clearPreparedReport()
              }}
            />
          </div>

          <div className="cove-window__field-row">
            <label htmlFor="issue-report-description">{t('issueReport.descriptionLabel')}</label>
            <textarea
              id="issue-report-description"
              data-testid="issue-report-description"
              value={description}
              placeholder={t('issueReport.descriptionPlaceholder')}
              onChange={event => {
                setDescription(event.target.value)
                clearPreparedReport()
              }}
            />
          </div>

          <div className="issue-report-window__details">
            <button
              type="button"
              className="issue-report-window__details-toggle"
              aria-expanded={isDetailsOpen}
              onClick={() => {
                setIsDetailsOpen(open => !open)
              }}
            >
              <span>{t('issueReport.includedDetails')}</span>
              <span>{t('issueReport.includedDetailsSummary')}</span>
            </button>

            {isDetailsOpen ? (
              <div className="issue-report-window__details-body">
                <label className="cove-window__checkbox">
                  <input
                    type="checkbox"
                    checked={includeLocalPaths}
                    onChange={event => {
                      setIncludeLocalPaths(event.target.checked)
                      clearPreparedReport()
                    }}
                  />
                  <span>{t('issueReport.includeLocalPaths')}</span>
                </label>
                <span className="cove-window__hint">{t('issueReport.localPathsHint')}</span>
              </div>
            ) : null}
          </div>

          {report ? (
            <div className="issue-report-window__ready" data-testid="issue-report-ready">
              <Check aria-hidden="true" size={16} />
              <div>
                <strong>{t('issueReport.generated')}</strong>
                <span>
                  {t('issueReport.generatedMeta', { fileName: reportFileName(report.reportPath) })}
                </span>
              </div>
            </div>
          ) : null}

          {error ? <p className="cove-window__error">{error}</p> : null}
        </div>

        <div className="cove-window__actions issue-report-window__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
          {report ? (
            <>
              <button
                type="button"
                className="cove-window__action cove-window__action--secondary"
                onClick={showReportFile}
              >
                <FolderOpen aria-hidden="true" size={14} />
                <span>{t('issueReport.showFile')}</span>
              </button>
              <button
                type="button"
                className="cove-window__action cove-window__action--secondary"
                onClick={copyReport}
              >
                <Copy aria-hidden="true" size={14} />
                <span>
                  {status === 'copied' ? t('issueReport.copied') : t('issueReport.copyReport')}
                </span>
              </button>
              <button
                type="button"
                className="cove-window__action cove-window__action--primary"
                onClick={openGitHubIssue}
              >
                <ExternalLink aria-hidden="true" size={14} />
                <span>{t('issueReport.openGitHub')}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="cove-window__action cove-window__action--primary"
              data-testid="issue-report-generate"
              disabled={status === 'generating'}
              onClick={() => {
                void prepareReport()
              }}
            >
              {status === 'generating' ? (
                <LoaderCircle aria-hidden="true" size={14} className="issue-report-window__spin" />
              ) : null}
              <span>
                {status === 'generating'
                  ? t('issueReport.regenerating')
                  : t('issueReport.generate')}
              </span>
            </button>
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}
