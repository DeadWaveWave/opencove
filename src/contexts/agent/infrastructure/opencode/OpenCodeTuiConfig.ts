import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OPENCODE_EMBEDDED_TUI_CONFIG_PATH = join(tmpdir(), 'opencove-opencode-tui.system.json')
const OPENCODE_EMBEDDED_TUI_CONFIG_CONTENT = `${JSON.stringify(
  {
    $schema: 'https://opencode.ai/tui.json',
    theme: 'system',
  },
  null,
  2,
)}\n`

export async function ensureOpenCodeEmbeddedTuiConfigPath(): Promise<string> {
  await writeFile(OPENCODE_EMBEDDED_TUI_CONFIG_PATH, OPENCODE_EMBEDDED_TUI_CONFIG_CONTENT, 'utf8')

  return OPENCODE_EMBEDDED_TUI_CONFIG_PATH
}
