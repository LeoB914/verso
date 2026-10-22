/** App-level error carrying an IPC error code (e.g. 'exists', 'invalid'). */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}
