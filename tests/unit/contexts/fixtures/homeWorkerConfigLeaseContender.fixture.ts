import { closeSync, openSync } from 'node:fs'
import { acquireHomeWorkerConfigLease } from '../../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'

type Command =
  | { type: 'acquire'; timeoutMs?: number }
  | { type: 'release' }
  | { type: 'hold-open'; path: string; ms?: number }
  | { type: 'close-hold' }

const userDataPath = process.argv[2]
let lease: Awaited<ReturnType<typeof acquireHomeWorkerConfigLease>> | null = null
let heldDescriptor: number | null = null
let holdTimer: ReturnType<typeof setTimeout> | null = null

function report(message: Record<string, unknown>): void {
  process.send?.(message)
}

function reportError(error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code
  const causeCode = ((error as { cause?: unknown } | null)?.cause as { code?: unknown } | undefined)
    ?.code
  report({
    type: 'error',
    code: typeof code === 'string' ? code : null,
    causeCode: typeof causeCode === 'string' ? causeCode : null,
    message: error instanceof Error ? error.message : String(error),
  })
}

function closeHold(): void {
  if (holdTimer) {
    clearTimeout(holdTimer)
    holdTimer = null
  }
  if (heldDescriptor !== null) {
    closeSync(heldDescriptor)
    heldDescriptor = null
    report({ type: 'closed', t: Date.now() })
  }
}

async function handle(command: Command): Promise<void> {
  switch (command.type) {
    case 'acquire':
      try {
        lease = await acquireHomeWorkerConfigLease(userDataPath, {
          timeoutMs: command.timeoutMs,
        })
        report({ type: 'acquired', t: Date.now() })
      } catch (error) {
        reportError(error)
      }
      return
    case 'release':
      try {
        await lease?.release()
        lease = null
        report({ type: 'released', t: Date.now() })
      } catch (error) {
        reportError(error)
      }
      return
    case 'hold-open':
      heldDescriptor = openSync(command.path, 'r')
      report({ type: 'holding', t: Date.now() })
      if (command.ms !== undefined) {
        holdTimer = setTimeout(closeHold, command.ms)
      }
      return
    case 'close-hold':
      closeHold()
      return
  }
}

process.on('message', message => {
  void handle(message as Command)
})
// An orphaned contender must not outlive the test that spawned it.
process.on('disconnect', () => process.exit(0))
report({ type: 'ready' })
