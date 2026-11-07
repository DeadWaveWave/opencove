import { StringDecoder } from 'node:string_decoder'
import { appendFile, readFile } from 'node:fs/promises'

/** Pasted CRs are data; only an unwrapped CR submits. Shared by strict provider fixtures. */
export async function runPromptStrictScenario(cwd, providerArgs, createHook) {
  const decoder = new StringDecoder('utf8')
  const recordPath = process.env.OPENCOVE_TEST_PROMPT_RECORD
  const dialogPath = process.env.OPENCOVE_TEST_PROMPT_DIALOG
  const record = async event => {
    if (recordPath) {
      await appendFile(recordPath, JSON.stringify(event) + '\n')
    }
  }
  const hook = await createHook(cwd, providerArgs)
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdout.write('\x1b[?2004h\r\nSTRICT_READY\r\n')
  let buffer = '',
    paste = false,
    draft = '',
    dialog = false,
    turn = 0
  let pending = Promise.resolve()
  const enterDialog = async () => {
    dialog = true
    await hook('PermissionRequest')
    await record({ kind: 'dialog', bytes: 0 })
    process.stdout.write('\r\nSTRICT_DIALOG\r\n')
  }
  // A filesystem trigger models a provider-side dialog without input to the target.
  let checking = false
  const timer = setInterval(() => {
    if (!dialogPath || dialog || checking) {
      return
    }
    checking = true
    void readFile(dialogPath)
      .then(() => {
        pending = pending.then(enterDialog)
      })
      .catch(() => {})
      .finally(() => {
        checking = false
      })
  }, 30)
  try {
    await new Promise((resolve, reject) => {
      process.stdin.on('data', chunk => {
        if (dialog) {
          pending = pending
            .then(async () => {
              await record({ kind: 'dialog_bytes', bytes: chunk.length })
              throw new Error('Dialog received input bytes')
            })
            .catch(reject)
          return
        }
        buffer += decoder.write(chunk)
        while (buffer.length) {
          if (paste) {
            const end = buffer.indexOf('\x1b[201~')
            if (end < 0) {
              break
            }
            draft += buffer.slice(0, end)
            buffer = buffer.slice(end + 6)
            paste = false
            const text = draft
            pending = pending.then(() => record({ kind: 'paste', text }))
          } else if (buffer.startsWith('\x1b[200~')) {
            buffer = buffer.slice(6)
            paste = true
          } else if ('\x1b[200~'.startsWith(buffer)) {
            break
          } else {
            const ch = buffer[0]
            buffer = buffer.slice(1)
            if (ch === '\x03') {
              pending.then(resolve, reject)
              return
            }
            if (ch === '\r') {
              const text = draft
              draft = ''
              const number = ++turn
              pending = pending.then(async () => {
                await record({ kind: 'submit', text, turn: number })
                await hook('UserPromptSubmit', { text, turn: number })
                await hook('Stop', { text, turn: number })
                process.stdout.write(`\r\nSTRICT_TURN_${number}\r\n`)
              })
            } else {
              draft += ch
            }
          }
        }
        pending.catch(reject)
      })
      process.stdin.once('end', () => pending.then(resolve, reject))
    })
  } finally {
    clearInterval(timer)
  }
}
