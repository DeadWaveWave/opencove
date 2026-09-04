export interface SerialOperationQueue {
  run: <T>(operation: () => Promise<T>) => Promise<T>
  whenIdle: () => Promise<void>
}

export function createSerialOperationQueue(): SerialOperationQueue {
  let tail: Promise<void> = Promise.resolve()

  return {
    run: <T>(operation: () => Promise<T>): Promise<T> => {
      const result = tail.then(operation, operation)
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
    whenIdle: async () => await tail,
  }
}
