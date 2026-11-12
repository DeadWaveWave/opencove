import type { CliIo } from './io'
import type { CommandArgs } from './command'
import { CliError } from './errors'
export function streamLifetime(args: CommandArgs, io: CliIo) {
  const controller = new AbortController()
  const abort = () =>
    controller.abort(
      io.signal?.reason instanceof CliError
        ? io.signal.reason
        : new CliError('cli.interrupted', 130, 'Interrupted'),
    )
  io.signal?.addEventListener('abort', abort, { once: true })
  if (io.signal?.aborted) {
    abort()
  }
  const timer =
    args.options.timeout === undefined
      ? undefined
      : setTimeout(
          () =>
            controller.abort(new CliError('events.timeout', 124, 'Event stream deadline expired.')),
          Number(args.options.timeout),
        )
  const race = <T>(promise: Promise<T>) => abortable(promise, controller.signal)
  return {
    io: {
      ...io,
      signal: controller.signal,
      readTextFile: (file: string) => race(io.readTextFile(file)),
      fetch: ((url, init) =>
        race(
          io.fetch(url, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, controller.signal])
              : controller.signal,
          }),
        )) as typeof fetch,
    },
    dispose() {
      clearTimeout(timer)
      io.signal?.removeEventListener('abort', abort)
      controller.abort()
    },
  }
}

/** Also bounds test adapters and filesystem calls that cannot accept an AbortSignal. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      cleanup()
      reject(signal.reason)
    }
    const cleanup = () => signal.removeEventListener('abort', stop)
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) {
      stop()
    }
    promise.then(
      value => {
        cleanup()
        resolve(value)
      },
      error => {
        cleanup()
        reject(error)
      },
    )
  })
}
