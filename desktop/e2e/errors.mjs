/** Error type for harness failures that should fail the job with a plain message. */
export class HarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessError";
  }
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
