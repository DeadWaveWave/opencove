import { useEffect, useRef, useState, type JSX } from 'react'
import { Copy } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import type { PluginSkillDetails } from '@contexts/plugins/domain/pluginRuntimeTypes'
import { pluginErrorMessage } from '@contexts/plugins/presentation/renderer/pluginErrorMessage'

export function PluginAgentTools({ plugin }: { plugin: PluginManifest }): JSX.Element | null {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setBusy(null)
    setFeedback(null)
    setError(null)
    return () => {
      generation.current = current + 1
    }
  }, [plugin.id, plugin.revision])

  async function copy(id: string, getText: () => Promise<string>): Promise<void> {
    const current = generation.current
    setBusy(id)
    setFeedback(null)
    setError(null)
    try {
      const text = await getText()
      if (current !== generation.current) {
        return
      }
      await window.opencoveApi.clipboard.writeText(text)
      if (current === generation.current) {
        setFeedback(t('settingsPanel.plugins.tools.copied'))
      }
    } catch (cause) {
      if (current === generation.current) {
        setError(pluginErrorMessage(cause))
      }
    } finally {
      if (current === generation.current) {
        setBusy(null)
      }
    }
  }
  if (!plugin.commands?.length && !plugin.skills?.length) {
    return null
  }
  return (
    <div className="settings-plugin-tools">
      {plugin.commands?.length ? (
        <section
          data-testid="settings-plugin-commands"
          aria-label={t('settingsPanel.plugins.tools.commands')}
        >
          <h4>{t('settingsPanel.plugins.tools.commands')}</h4>
          {plugin.commands.map(command => {
            const needsNode = command.target === 'window' && plugin.view?.instances !== 'single'
            const selector =
              command.target === 'plugin'
                ? ''
                : needsNode
                  ? ' --node <node-id>'
                  : ' --project <project-id>'
            const invocation = `opencove plugin run ${plugin.id} ${command.id}${selector}`
            return (
              <div className="settings-plugin-tools__row" key={command.id}>
                <div className="settings-plugin-tools__description">
                  <span>{command.title}</span>
                  <p>{command.description}</p>
                  <code>{invocation}</code>
                  <p>
                    {t(
                      `settingsPanel.plugins.tools.${command.target === 'plugin' ? 'withoutWindow' : needsNode ? 'selectedWindow' : 'singleWindow'}`,
                    )}
                  </p>
                  {command.usage ? <pre>{command.usage}</pre> : null}
                </div>
                <button
                  type="button"
                  className="cove-window__action cove-window__action--secondary"
                  disabled={busy !== null}
                  aria-label={t('settingsPanel.plugins.tools.copyCommand', { name: command.title })}
                  onClick={() => void copy(`command:${command.id}`, async () => invocation)}
                >
                  <Copy size={14} aria-hidden="true" />
                  {t('settingsPanel.plugins.tools.copy')}
                </button>
              </div>
            )
          })}
        </section>
      ) : null}
      {plugin.skills?.length ? (
        <section aria-label={t('settingsPanel.plugins.tools.skills')}>
          <h4>{t('settingsPanel.plugins.tools.skills')}</h4>
          <p className="settings-plugin-tools__help">
            {t('settingsPanel.plugins.tools.skillsHelp')}
          </p>
          {plugin.skills.map(skill => (
            <div className="settings-plugin-tools__row" key={skill.id}>
              <div className="settings-plugin-tools__description">
                <span>{skill.id}</span>
                <p>{skill.description}</p>
              </div>
              <button
                type="button"
                className="cove-window__action cove-window__action--secondary"
                disabled={busy !== null}
                data-testid={`settings-plugin-skill-copy-${skill.id}`}
                onClick={() =>
                  void copy(`skill:${skill.id}`, async () => {
                    const detail =
                      await window.opencoveApi.controlSurface.invoke<PluginSkillDetails>({
                        kind: 'query',
                        id: 'plugin.skill.get',
                        payload: { pluginId: plugin.id, skillId: skill.id },
                      })
                    return detail.installPrompt
                  })
                }
              >
                <Copy size={14} aria-hidden="true" />
                {t('settingsPanel.plugins.tools.copySkill')}
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {feedback ? (
        <p className="settings-plugin-guide__feedback" role="status">
          {feedback}
        </p>
      ) : null}
      {error ? (
        <p className="cove-window__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
