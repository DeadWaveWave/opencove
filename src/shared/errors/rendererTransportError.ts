/** No application code: a lost response cannot prove whether an operation committed. */
export class RendererTransportError extends Error {
  constructor() {
    super('OpenCove could not confirm the operation. Check its status before trying again.')
    this.name = 'RendererTransportError'
  }
}
