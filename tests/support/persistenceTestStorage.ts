export class MockStorage implements Storage {
  private store = new Map<string, string>()

  public get length(): number {
    return this.store.size
  }

  public clear(): void {
    this.store.clear()
  }

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  public key(index: number): string | null {
    const keys = [...this.store.keys()]
    return keys[index] ?? null
  }

  public removeItem(key: string): void {
    this.store.delete(key)
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

export function installMockStorage(): MockStorage {
  const storage = new MockStorage()

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  })

  return storage
}
