/** Matched IO can revoke input independently of the hook/file state classifier. */
export class ClaudeConversationInput {
  private after?: number
  private readonly prompts = new Set<string>()
  private overflow = false
  get blocked(): boolean {
    return this.after !== undefined || this.prompts.size > 0 || this.overflow
  }
  block(at: number, promptId?: string): void {
    if (promptId !== undefined) {
      if (this.prompts.size === 64 && !this.prompts.has(promptId)) {
        this.overflow = true
      } else {
        this.prompts.add(promptId)
      }
    } else {
      this.after = Math.max(this.after ?? -Infinity, at)
    }
  }
  confirm(at: number, promptId?: string): void {
    if (promptId !== undefined) {
      this.prompts.delete(promptId)
    }
    if (this.after !== undefined && at >= this.after) {
      this.after = undefined
    }
  }
  releaseConversation(id: string): void {
    this.prompts.delete(`conversation:${id}`)
  }
  clear(): void {
    this.after = undefined
    this.prompts.clear()
    this.overflow = false
  }
}
