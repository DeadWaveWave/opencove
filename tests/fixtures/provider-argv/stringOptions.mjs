// Source-pinned inert branch ports; only option parsing, no CLI imports/IO.
// OpenCode 1.3.13 bundled yargs-parser:899121 uses /^--([^=]+)=([\s\S]*)$/.
// Gemini 0.32.1 yargs-parser/build/lib/yargs-parser.js:191 same attached-value branch.
// Kimi 1.16.0 click/parser.py:368,449 consumes a required value even with a leading dash.
export function parseStringOptions(provider, args) {
  const values = {}
  const operands = []
  const flags = ['--yolo', '--auto']
  const required = [
    '--prompt',
    '--prompt-interactive',
    '--model',
    '--hostname',
    '--port',
    '--session',
    '--resume',
    '--settings',
    '-e',
  ]
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const attached = /^--([^=]+)=([\s\S]*)$/.exec(arg)
    if (attached) {
      values[`--${attached[1]}`] = attached[2]
    } else if (flags.includes(arg)) {
      values[arg] = true
    } else if (required.includes(arg)) {
      const value = args[++i]
      if (provider !== 'kimi' && value?.startsWith('-')) {
        throw new Error('Option value interpreted as an option')
      }
      values[arg] = value
    } else if (arg.startsWith('-')) {
      throw new Error('Unexpected option')
    } else {
      operands.push(arg)
    }
  }
  return { values, operands }
}
// Codex 0.166.0 utils/cli/src/config_override.rs:29-36: -c/--config, Append, Vec<String>.
// Clap 4.5.58 parser.rs:103-105,277-301 consumes pending values before command dispatch;
// 880-922,991-1010 handles attached/required values; 119-134 protects trailing values.
export function parseCodex(args) {
  const delimiter = args.indexOf('--')
  const control = delimiter < 0 ? args : args.slice(0, delimiter)
  const values = {}
  let command
  for (let i = 0; i < control.length; i++) {
    const arg = control[i]
    let config
    if (arg === '--config' || arg === '-c') {
      config = control[++i]
      if (config === undefined || (config !== '-' && config.startsWith('-'))) {
        throw new Error('The config option requires a value.')
      }
    } else if (arg.startsWith('--config=')) {
      config = arg.slice('--config='.length)
    } else if (arg.startsWith('-c') && arg.length > 2) {
      config = arg.slice(2).replace(/^=/, '')
    }
    if (config !== undefined) {
      ;(values['--config'] ??= []).push(config)
    } else if (['--model', '--sandbox', '--ask-for-approval'].includes(arg)) {
      values[arg] = control[++i]
    } else if (arg.startsWith('-')) {
      values[arg] = true
    } else {
      command = arg
    }
  }
  return { command, values, prompt: delimiter < 0 ? undefined : args[delimiter + 1] }
}
// Codex 0.166.0 skills/src/mentions.rs:88-149,226-228 scans every byte, including quotes/backslashes.
export function selectCodexSkills(text, catalog = ['explain']) {
  const names = [...text.matchAll(/\$([A-Za-z0-9_:-]+)/g)].map(match => match[1])
  return catalog.filter(name => names.includes(name))
}
