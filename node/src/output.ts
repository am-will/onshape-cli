export function emit(result: unknown): void {
  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

export function emitError(error: string, detail: unknown = null): void {
  console.log(JSON.stringify({ ok: false, error, detail }, null, 2));
}

export class CliError extends Error {
  readonly detail: unknown;
  readonly exitCode: number;

  constructor(message: string, detail: unknown = null, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.detail = detail;
    this.exitCode = exitCode;
  }
}
