import type { Command, OptionSpec } from './command'
import { globals } from './args'
import { sections, commandExamples } from './helpCatalog'
const footer = 'Global options: see "opencove --help".'
function rows(entries: [string, string][]) {
  const width = Math.max(...entries.map(([name]) => name.length))
  return entries.map(([name, description]) => `  ${name.padEnd(width)}  ${description}`)
}
function option(name: string, spec: OptionSpec) {
  return `--${name}${spec.type === 'boolean' ? '' : name === 'output' ? ' json|table' : ` <${spec.valueName ?? name}>`}`
}
export function help(commands: Command[], path: string[]) {
  if (!path.length) {
    const lines = [
      'OpenCove CLI — Control projects, spaces, canvas nodes and worker runtimes',
      '',
      'Usage: opencove <command> [options]',
    ]
    for (const [section, entries] of sections) {
      lines.push('', `${section}:`, ...rows(entries))
    }
    lines.push(
      '',
      'Global options:',
      ...rows(
        Object.entries(globals).map(([name, spec]) => [
          `${name === 'help' ? '-h, ' : name === 'output' ? '-o, ' : ''}${option(name, spec)}`,
          spec.description,
        ]),
      ),
      '',
      'Run "opencove <group> --help" for commands in a group. Run "opencove api ops" to list every Control Surface operation.',
    )
    return lines.join('\n') + '\n'
  }
  const prefix = `opencove ${path.join(' ')}`
  const exact = commands.find(c => c.path.join(' ') === path.join(' '))
  if (exact) {
    const required = Object.entries(exact.options ?? {})
      .filter(([, s]) => s.required)
      .map(([name, s]) => option(name, s))
    const positionals = (exact.positionals ?? []).map(p =>
      p.required ? `<${p.name}>` : `[${p.name}]`,
    )
    const target =
      exact.targetSpace === 'required' ? ['(--space <id> | <other-target-space-options>)'] : []
    const lines = [
      `Usage: ${[prefix, ...positionals, ...target, ...required, '[options]'].join(' ')}`,
      '',
      exact.summary,
    ]
    if (exact.description) {
      lines.push('', exact.description)
    }
    if (exact.targetSpace) {
      lines.push(
        '',
        `Target space (${exact.targetSpace === 'required' ? 'choose exactly one' : 'optional; choose one'}):`,
        ...rows([
          ['--space <id>', 'Select a space by its ID'],
          [
            '--space-name <name> [--project <id>]',
            'Find a named space, optionally within a project',
          ],
          ['--worker <id-or-name> --branch <branch>', 'Find a space by worker and Git branch'],
          [
            '--worker <id-or-name> --path <absolute-path>',
            'Find a space by worker and working directory',
          ],
        ]),
        '  Add --project <id> to narrow a name, branch or path lookup',
      )
    }
    const entries: [string, string][] = []
    for (const [name, spec] of Object.entries(exact.options ?? {})) {
      if (
        exact.targetSpace &&
        ['space', 'space-name', 'worker', 'branch', 'path', 'project'].includes(name)
      ) {
        continue
      }
      entries.push([option(name, spec), `${spec.description}${spec.required ? ' (required)' : ''}`])
      if (spec.fileVariant) {
        entries.push([
          `--${name}-file <path|->`,
          `Read ${name} from a UTF-8 file, or use - for stdin`,
        ])
      }
    }
    if (entries.length) {
      lines.push('', 'Options:', ...rows(entries))
    }
    const examples = exact.examples ??
      commandExamples[path.join(' ')] ?? [
        prefix +
          (required.length ? ' ' + required.join(' ') : '') +
          (positionals.length ? ' ' + positionals.join(' ') : ''),
        prefix + ' --help',
      ]
    lines.push('', 'Examples:', ...examples.map(e => `  ${e}`), '', footer)
    return lines.join('\n') + '\n'
  }
  const children = new Map<string, Command[]>()
  for (const c of commands) {
    if (path.every((p, i) => c.path[i] === p) && c.path.length > path.length) {
      const key = c.path[path.length]
      children.set(key, [...(children.get(key) ?? []), c])
    }
  }
  const ordered = [...children]
  if (path.join(' ') === 'node') {
    const order = ['list', 'get', 'create', 'update', 'delete']
    ordered.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
  }
  const entries: [string, string][] = ordered.map(([name, items]) => {
    const nested = items.filter(c => c.path.length > path.length + 1)
    return nested.length
      ? [
          `${name} <${nested.map(c => c.path[path.length + 1]).join('|')}>`,
          `${name[0].toUpperCase() + name.slice(1)} ${path[0] === 'node' ? 'canvas nodes' : 'canvas targets'}`,
        ]
      : [name, items[0].summary]
  })
  return (
    [`Usage: ${prefix} <command> [options]`, '', 'Commands:', ...rows(entries), '', footer].join(
      '\n',
    ) + '\n'
  )
}
