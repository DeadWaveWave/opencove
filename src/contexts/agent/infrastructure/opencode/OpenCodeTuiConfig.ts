import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OPENCODE_EMBEDDED_TUI_CONFIG_PATH = join(tmpdir(), 'opencove-opencode-tui.embedded.json')

export async function ensureOpenCodeEmbeddedTuiConfigPath(): Promise<string> {
  const config = {
    $schema: 'https://opencode.ai/tui.json',
    theme: 'system',
  }

  await writeFile(OPENCODE_EMBEDDED_TUI_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  return OPENCODE_EMBEDDED_TUI_CONFIG_PATH
}
