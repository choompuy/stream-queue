export class ForbiddenOriginError extends Error {
  constructor() {
    super('Forbidden origin')
    this.name = 'ForbiddenOriginError'
  }
}