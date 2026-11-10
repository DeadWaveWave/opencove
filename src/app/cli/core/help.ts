import { shellWord } from './shellWord'
import type { Command, OptionSpec } from './command'
import { globals } from './args'
import { sections, commandExamples } from './helpCatalog'
import { selectorDescription } from './selectors'
const footer = 'Global options: see "opencove --help".'
const discovery = [
  'Start with "opencove api ops --domains" for a compact domain map.',
  'Then run "opencove api ops --prefix node --fields id,cliCommand" to explore one domain.',
  'Run "opencove api ops" only when you need the full catalog.',
]
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
      'Selectors:',
      '  Node, space and project options accept @self, an exact ID, an exact name (case-sensitive), or a unique ID prefix of 6+ characters.',
      '  @self uses your terminal identity. Names are scoped by --project or your own project inside OpenCove; explicit --space constrains every node selector, including full IDs. Ambiguous targets require a full ID.',
      '',
      'Global options:',
      ...rows(
        Object.entries(globals).map(([name, spec]) => [
          `${name === 'help' ? '-h, ' : name === 'output' ? '-o, ' : ''}${option(name, spec)}`,
          spec.description,
        ]),
      ),
      '',
      'Exit codes: 0 success; 1 operation failure; 2 invalid input; 3 unreachable; 4 unauthorized; 5 incompatible protocol; 6 ambiguous target; 10 waiting observed; 11 agent exited during wait; 124 timeout; 130 interrupted.',
      '',
      'Run "opencove <group> --help" for commands in a group.',
      ...discovery,
      'AI agents: run `opencove skill` for a usage guide.',
    )
    return lines.join('\n') + '\n'
  }
  const prefix = `opencove ${path.join(' ')}`
  const exact = commands.find(c => c.path.join(' ') === path.join(' '))
  if (exact) {
    const required = Object.entries(exact.options ?? {})
      .filter(([, s]) => s.required)
      .map(([name, s]) => (s.defaultSelf ? `[${option(name, s)}]` : option(name, s)))
    const positionals = (exact.positionals ?? []).map(p =>
      p.required ? `<${p.name}>` : `[${p.name}]`,
    )
    const target =
      exact.targetSpace === 'required'
        ? [
            exact.options?.space?.defaultSelf
              ? exact.currentContainer
                ? '[--root-canvas | --space <id> | <other-target-space-options>]'
                : '[--space <id> | <other-target-space-options>]'
              : '(--space <id> | <other-target-space-options>)',
          ]
        : []
    const examplePositionals = (exact.positionals ?? [])
      .filter(p => p.required)
      .map(p => (p.name === 'operation-id' ? 'node.create' : shellWord(`<${p.name}>`)))
    const exampleRequired = Object.entries(exact.options ?? {})
      .filter(([, s]) => s.required)
      .map(
        ([name, s]) =>
          `--${name}${s.type === 'boolean' ? '' : ' ' + (s.type === 'number' ? '39291' : shellWord(`<${s.valueName ?? name}>`))}`,
      )
    const lines = [
      `Usage: ${exact.usage ? `${prefix} ${exact.usage}` : [prefix, ...positionals, ...target, ...required, '[options]'].join(' ')}`,
      '',
      exact.summary,
    ]
    if (exact.description) {
      lines.push('', exact.description)
    }
    if (Object.values(exact.options ?? {}).some(spec => spec.defaultSelf)) {
      lines.push(
        '',
        exact.operation === 'node.list'
          ? 'Default target inside OpenCove: your current Space. Outside every Space, list all nodes in your project; use --root-canvas to list only root nodes. An explicit --project lists that project.'
          : exact.currentContainer
            ? 'Default target inside OpenCove: your current Space, or the root canvas when you are outside any Space. An explicit --project selects project scope for lists; creation also needs --root-canvas or a Space target.'
            : exact.options?.space?.defaultSelf
              ? 'When no target is given, inside OpenCove defaults to your own space; project options default to your own project.'
              : 'When no project is given, inside OpenCove defaults to your own project.',
      )
    }
    if (exact.targetSpace) {
      lines.push(
        '',
        exact.currentContainer
          ? 'Target container (choose one):'
          : `Target space (${exact.options?.space?.defaultSelf ? 'choose one; inside OpenCove defaults to your own space' : exact.targetSpace === 'required' ? 'choose exactly one' : 'optional; choose one'}):`,
        ...rows([
          ...(exact.options?.['root-canvas']
            ? [['--root-canvas', exact.options['root-canvas'].description] as [string, string]]
            : []),
          ['--space <id>', selectorDescription(exact.options!.space)],
          [
            '--space-name <name> [--project <id>]',
            'Find a named space, optionally within a project',
          ],
          ['--worker <id-or-name> --branch <branch>', 'Find a space by worker and Git branch'],
          [
            '--worker <id-or-name> --path <absolute-path>',
            'Find a space by worker and working directory',
          ],
          [
            '--project <id>',
            selectorDescription({
              ...exact.options!.project,
              description:
                exact.operation === 'node.list'
                  ? 'Select the project to list, or narrow a Space lookup'
                  : exact.currentContainer
                    ? 'Select the root-canvas project, or narrow a Space lookup'
                    : 'Narrow a space name, branch or path lookup to one project',
            }),
          ],
        ]),
      )
    }
    if (exact.render?.defaultLimit) {
      lines.push(
        '',
        `Shows up to ${exact.render.defaultLimit} results in Worker order. Use --full or --limit 0 for all; --limit <n> overrides the default.`,
      )
    }
    const entries: [string, string][] = []
    for (const [name, spec] of Object.entries(exact.options ?? {})) {
      if (
        exact.targetSpace &&
        ['root-canvas', 'space', 'space-name', 'worker', 'branch', 'path', 'project'].includes(name)
      ) {
        continue
      }
      entries.push([
        `${spec.short ? '-' + spec.short + ', ' : ''}${option(name, spec)}`,
        `${selectorDescription(spec)}${spec.required ? (spec.defaultSelf ? ' (required outside OpenCove)' : ' (required)') : ''}`,
      ])
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
    if (
      exact.render?.listKey ||
      exact.render?.list ||
      exact.rawQueryFields ||
      path.join(' ') === 'context'
    ) {
      lines.push(
        '',
        'List output: --limit <n> keeps up to n items per list; 0 means all. Cut object lists add top-level truncated totals; bare arrays keep their shape and write one stderr notice. Cut tables also write one stderr notice.',
      )
    }
    lines.push(
      '',
      `Table output (-o table): ${exact.render?.columns?.length ? 'supported' : 'not supported'}.`,
    )
    lines.push(
      exact.render?.fields
        ? `Projectable fields: ${exact.render.fields.join(', ')}`
        : exact.rawQueryFields
          ? 'Field projection (--fields): queries accept raw output dot paths and item-relative aliases from dedicated commands with declared output fields; validated after the read. Commands do not support projection.'
          : `Field projection (--fields): not supported.${exact.render?.unavailable ? ' ' + exact.render.unavailable : ''}`,
    )
    if (exact.render?.examples) {
      lines.push(
        '',
        'Projection example:',
        ...exact.render.examples.map(
          e =>
            `  ${e.startsWith('--') ? [prefix, ...examplePositionals, ...exampleRequired, ...(exact.targetSpace === 'required' ? ['--space space-123'] : []), e].join(' ') : e}`,
        ),
      )
    }
    const examples = exact.examples ??
      commandExamples[path.join(' ')] ?? [
        prefix +
          (exampleRequired.length ? ' ' + exampleRequired.join(' ') : '') +
          (examplePositionals.length ? ' ' + examplePositionals.join(' ') : ''),
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
  if (['node', 'agent'].includes(path.join(' '))) {
    const order =
      path[0] === 'agent'
        ? ['list', 'get', 'prompt', 'wait', 'read']
        : ['list', 'get', 'create', 'update', 'delete']
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
    [
      `Usage: ${prefix} <command> [options]`,
      ...(path.join(' ') === 'api' ? ['', ...discovery] : []),
      '',
      'Commands:',
      ...rows(entries),
      '',
      footer,
    ].join('\n') + '\n'
  )
}
