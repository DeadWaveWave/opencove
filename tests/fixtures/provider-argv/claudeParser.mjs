/* eslint-disable no-unused-expressions -- Preserve the installed parser branch semantics. */
// Claude Code 2.1.322: Commander parseOptions/_findCommand copied verbatim from
// ~/.local/share/claude/versions/2.1.322:2459909. No application imports or callbacks.
import registry from './claudeRegistry.json' with { type: 'json' }
class Parser {
  commands = registry.map(name => ({ _name: name, _aliases: [] }))
  values = {}
  _findOption(flag) {
    const required = ['--permission-mode', '--session-id', '--resume', '--model', '--settings']
    const boolean = [
      '--dangerously-skip-permissions',
      '--agent-teams',
      '--hard-fail',
      '--help',
      '-p',
    ]
    return required.includes(flag) || boolean.includes(flag)
      ? { required: required.includes(flag), name: () => flag }
      : undefined
  }
  emit(name, value = true) {
    this.values[name.slice(7)] = value
  }
  optionMissingArgument() {
    throw new Error('Missing option value')
  }
  parseOptions(t) {
    let e = [],
      i = [],
      n = e,
      s = t.slice()
    function r(o) {
      return o.length > 1 && o[0] === '-'
    }
    let a = null
    while (s.length) {
      let o = s.shift()
      if (o === '--') {
        if (n === i) {
          n.push(o)
        }
        n.push(...s)
        break
      }
      if (a && !r(o)) {
        this.emit(`option:${a.name()}`, o)
        continue
      }
      if (((a = null), r(o))) {
        let h = this._findOption(o)
        if (h) {
          if (h.required) {
            let u = s.shift()
            if (u === void 0) {
              this.optionMissingArgument(h)
            }
            this.emit(`option:${h.name()}`, u)
          } else if (h.optional) {
            let u = null
            if (s.length > 0 && !r(s[0])) {
              u = s.shift()
            }
            this.emit(`option:${h.name()}`, u)
          } else {
            this.emit(`option:${h.name()}`)
          }
          a = h.variadic ? h : null
          continue
        }
      }
      if (o.length > 2 && o[0] === '-' && o[1] !== '-') {
        let h = this._findOption(`-${o[1]}`)
        if (h) {
          if (h.required || (h.optional && this._combineFlagAndOptionalValue)) {
            this.emit(`option:${h.name()}`, o.slice(2))
          } else {
            ;(this.emit(`option:${h.name()}`), s.unshift(`-${o.slice(2)}`))
          }
          continue
        }
      }
      if (/^--[^=]+=/.test(o)) {
        let h = o.indexOf('='),
          u = this._findOption(o.slice(0, h))
        if (u && (u.required || u.optional)) {
          this.emit(`option:${u.name()}`, o.slice(h + 1))
          continue
        }
      }
      if (r(o)) {
        n = i
      }
      if (
        (this._enablePositionalOptions || this._passThroughOptions) &&
        e.length === 0 &&
        i.length === 0
      ) {
        if (this._findCommand(o)) {
          if ((e.push(o), s.length > 0)) {
            i.push(...s)
          }
          break
        } else if (this._getHelpCommand() && o === this._getHelpCommand().name()) {
          if ((e.push(o), s.length > 0)) {
            e.push(...s)
          }
          break
        } else if (this._defaultCommandName) {
          if ((i.push(o), s.length > 0)) {
            i.push(...s)
          }
          break
        }
      }
      if (this._passThroughOptions) {
        if ((n.push(o), s.length > 0)) {
          n.push(...s)
        }
        break
      }
      n.push(o)
    }
    return { operands: e, unknown: i }
  }
  _findCommand(t) {
    if (!t) {
      return
    }
    return this.commands.find(e => e._name === t || e._aliases.includes(t))
  }
}
export function parseClaude(args) {
  const parser = new Parser()
  const { operands, unknown } = parser.parseOptions(args)
  // Installed _parseCommand checks _findCommand(operands[0]) after option parsing.
  const command = parser._findCommand(operands[0])?._name
  // Installed raw includes consumers deliberately ignore --.
  const raw = args.filter(arg =>
    ['--agent-teams', '--hard-fail', '--session-tunnel', '--handle-uri'].includes(arg),
  )
  // UGt stops at -- and skips required option values (2446000).
  let connect
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') {
      break
    }
    if (args[i].startsWith('cc://') || args[i].startsWith('cc+unix://')) {
      connect = args[i]
    }
    if (parser._findOption(args[i])?.required) {
      i++
    }
  }
  return {
    command,
    prompt: command ? undefined : operands[0],
    values: parser.values,
    raw,
    connect,
    unknown,
  }
}
