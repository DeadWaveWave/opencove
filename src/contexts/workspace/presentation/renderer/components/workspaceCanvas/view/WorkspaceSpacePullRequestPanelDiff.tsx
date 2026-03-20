import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { parseUnifiedDiff } from './unifiedDiff'

export function WorkspaceSpacePullRequestPanelDiff({
  isLoading,
  diff,
}: {
  isLoading: boolean
  diff: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const parsed = React.useMemo(() => (diff ? parseUnifiedDiff(diff) : null), [diff])
  const [collapsedByFileKey, setCollapsedByFileKey] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    if (!parsed) {
      setCollapsedByFileKey({})
      return
    }

    const next: Record<string, boolean> = {}
    const shouldCollapseByDefault = parsed.files.length > 1
    parsed.files.forEach((file, index) => {
      next[file.key] = shouldCollapseByDefault ? index > 0 : false
    })
    setCollapsedByFileKey(next)
  }, [parsed])

  if (isLoading) {
    return <div className="workspace-pr-panel__loading">{t('common.loading')}</div>
  }

  if (diff && parsed?.files.length) {
    return (
      <div className="workspace-pr-panel__diff-view" data-testid="workspace-space-pr-panel-diff">
        {parsed.files.map(file => {
          const isCollapsed = collapsedByFileKey[file.key] ?? false
          return (
            <section key={file.key} className="workspace-pr-panel__diff-file">
              <button
                type="button"
                className="workspace-pr-panel__diff-file-header"
                aria-expanded={!isCollapsed}
                aria-label={file.path}
                onClick={() => {
                  setCollapsedByFileKey(prev => ({
                    ...prev,
                    [file.key]: !(prev[file.key] ?? false),
                  }))
                }}
              >
                <span className="workspace-pr-panel__diff-file-path">{file.path}</span>
                <span className="workspace-pr-panel__diff-file-stats">
                  {file.addedLines ? (
                    <span className="workspace-pr-panel__diff-stat workspace-pr-panel__diff-stat--add">
                      +{file.addedLines}
                    </span>
                  ) : null}
                  {file.deletedLines ? (
                    <span className="workspace-pr-panel__diff-stat workspace-pr-panel__diff-stat--del">
                      -{file.deletedLines}
                    </span>
                  ) : null}
                </span>
              </button>

              {!isCollapsed ? (
                <div className="workspace-pr-panel__diff-file-body">
                  {file.isBinary ? (
                    <div className="workspace-pr-panel__diff-binary">
                      {t('githubPullRequest.binaryDiff')}
                    </div>
                  ) : (
                    file.hunks.map(hunk => (
                      <div key={hunk.header} className="workspace-pr-panel__diff-hunk">
                        <div className="workspace-pr-panel__diff-hunk-header">{hunk.header}</div>
                        <div className="workspace-pr-panel__diff-lines">
                          {hunk.lines.map(line => {
                            const lineKey = `${line.type}:${line.oldLineNumber ?? ''}:${line.newLineNumber ?? ''}:${line.content}`

                            if (line.type === 'meta') {
                              const message = line.content.startsWith(
                                '\\ No newline at end of file',
                              )
                                ? t('githubPullRequest.noNewlineAtEof')
                                : line.content.replace(/^\\\s*/, '')

                              return (
                                <div
                                  key={lineKey}
                                  className="workspace-pr-panel__diff-meta"
                                  aria-label={message}
                                >
                                  {message}
                                </div>
                              )
                            }

                            const prefix =
                              line.type === 'add'
                                ? '+'
                                : line.type === 'del'
                                  ? '-'
                                  : line.type === 'context'
                                    ? ' '
                                    : ''

                            return (
                              <div
                                key={lineKey}
                                className={`workspace-pr-panel__diff-line workspace-pr-panel__diff-line--${line.type}`}
                              >
                                <span className="workspace-pr-panel__diff-line-num">
                                  {line.oldLineNumber ?? ''}
                                </span>
                                <span className="workspace-pr-panel__diff-line-num">
                                  {line.newLineNumber ?? ''}
                                </span>
                                <span className="workspace-pr-panel__diff-line-prefix">
                                  {prefix}
                                </span>
                                <span className="workspace-pr-panel__diff-line-content">
                                  {line.content}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    )
  }

  if (diff) {
    return (
      <pre className="workspace-pr-panel__diff" data-testid="workspace-space-pr-panel-diff">
        {diff}
      </pre>
    )
  }

  return (
    <div className="workspace-pr-panel__empty" data-testid="workspace-space-pr-panel-diff-empty">
      {t('githubPullRequest.noDiff')}
    </div>
  )
}
