export class BoundedRingBuffer<T> {
  readonly capacity: number
  private readonly entries: Array<T | undefined>
  private start = 0
  private count = 0

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError('BoundedRingBuffer capacity must be a positive safe integer.')
    }

    this.capacity = capacity
    this.entries = new Array<T | undefined>(capacity)
  }

  push(value: T): void {
    const index = (this.start + this.count) % this.capacity
    this.entries[index] = value

    if (this.count < this.capacity) {
      this.count += 1
      return
    }

    this.start = (this.start + 1) % this.capacity
  }

  snapshot(): T[] {
    return Array.from({ length: this.count }, (_, offset) => {
      const value = this.entries[(this.start + offset) % this.capacity]
      if (value === undefined) {
        throw new Error('BoundedRingBuffer invariant violated: occupied entry is missing.')
      }
      return value
    })
  }

  clear(): void {
    this.entries.fill(undefined)
    this.start = 0
    this.count = 0
  }
}
